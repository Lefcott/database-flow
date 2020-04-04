const moment = require('moment');
const Redis = require('redis');

const object = require('./object');

module.exports = (url, helloMessage, models, rollbar) => {
  const redis = Redis.createClient(url);

  redis.on('error', err => {
    rollbar.error(`Redis error: ${err}`);
  });

  redis.on('end', () => {
    console.log('Redis connection closed');
  });

  helloMessage &&
    redis.on('connect', () => {
      console.log('Connected to REDIS!');
    });

  const transformMembers = (model, members) =>
    members.map(member => {
      const tMember = { ...member };
      const keys = Object.keys(tMember);
      for (let k = 0; k < keys.length; k += 1) {
        const field = models[model].tableAttributes[keys[k]];

        if (field && field.type.constructor.key === 'DATE' && tMember[keys[k]]) {
          tMember[keys[k]] = moment(tMember[keys[k]]).valueOf();
        }
      }
      return tMember;
    });

  const filterMembers = (model, members, where) => {
    if (!where || Object.keys(where).length === 0) {
      return members;
    }
    const baseMembers = transformMembers(model, members);
    const result = [];
    for (let k = 0; k < baseMembers.length; k += 1) {
      if (object.check(baseMembers[k], where)) {
        result.push(members[k]);
      }
    }
    return result;
  };

  // Returning null || [member {}]
  redis.find = (eventId, model, where = null, ...include) =>
    new Promise(resolve => {
      const finishEvent = eventId == null;
      eventId = eventId == null ? rollbar.startEvent() : eventId;
      // This method is used by redis.delete
      redis.smembers(model, async (error, members) => {
        if (error || !members) {
          rollbar
            .error(
              `REDIS Error getting users, options:\n ${JSON.stringify(where, null, 2)}`,
              `\n\nError:${error}\n\nResult: ${members}`
            )
            .useEvent(eventId);
          finishEvent && rollbar.finishEvent(eventId);
          return resolve(null);
        }
        members = members.map(member => JSON.parse(member));
        members = filterMembers(model, members, where);

        if (!include || !include.length) {
          finishEvent && rollbar.finishEvent(eventId);
          return resolve(members);
        }
        let included = [];
        for (let k = 0; k < include.length; k += 1) {
          const currInclude = include[k].include || [];
          included.push(redis.find(eventId, include[k].model, include[k].where, ...currInclude));
        }
        included = await Promise.all(included);
        for (let n = 0; n < members.length; n += 1) {
          const thisMember = members[n];
          for (let k = 0; k < include.length; k += 1) {
            members[n][include[k].model] = [];
            const currModel = include[k].model;

            if (!models[model].relations[currModel]) {
              rollbar
                .error(`REDIS: model "${model}" has no relations with model "${currModel}".`)
                .useEvent(eventId);
              continue;
            }
            if (!models[model].relations) {
              rollbar.error(`REDIS: model "${model}" has no relations with any model !!`).useEvent(eventId);
              continue;
            }
            const { thisKey, otherKey } = models[model].relations[currModel];
            if (!thisKey || !otherKey) {
              rollbar
                .error(`REDIS: model "${model}" has no thisKey or otherKey for model "${currModel}".`)
                .useEvent(eventId);
              continue;
            }
            for (let m = 0; m < included.length; m += 1) {
              const curIncluded = (included[m] || []).filter(
                other => other[otherKey] === thisMember[thisKey]
              );
              members[n][include[m].model] = curIncluded;
            }
          }
        }
        members = members.filter(member => {
          for (let k = 0; k < include.length; k += 1) {
            if (models[model].relations[include[k].model].innerJoin === false) {
              continue;
            }
            if (!member[include[k].model] || member[include[k].model].length === 0) {
              return false;
            }
          }
          return true;
        });
        if (finishEvent) {
          rollbar.finishEvent(eventId);
        }
        return resolve(members);
      });
    });

  // Returning true || false || null
  redis.delete = (eventId, model, where = {}) =>
    new Promise(async resolve => {
      const finishEvent = eventId == null;
      eventId = eventId == null ? rollbar.startEvent() : eventId;
      let members = await redis.find(eventId, model, where);
      if (!members) {
        finishEvent && rollbar.finishEvent(eventId);
        return resolve(null);
      }
      if (members.length === 0) {
        finishEvent && rollbar.finishEvent(eventId);
        return resolve(false);
      }
      members = members.map(member => JSON.stringify(member));

      redis.srem(model, members, (error, response) => {
        if (error) {
          rollbar
            .error(
              `REDIS Error deleting users, options:\n ${JSON.stringify(where, null, 2)}`,
              `\n\nError:${error}\n\nResponse: ${response}`
            )
            .useEvent(eventId);
          finishEvent && rollbar.finishEvent(eventId);
          return resolve(null);
        }
        finishEvent && rollbar.finishEvent(eventId);
        resolve(true);
      });
    });

  // Returning true || false
  redis.create = (eventId, model, registers) =>
    new Promise(resolve => {
      const finishEvent = eventId == null;
      eventId = eventId == null ? rollbar.startEvent() : eventId;
      const regsToAdd = registers.map(Reg => {
        const reg = { ...Reg };
        const keys = Object.keys(reg);
        const modelNames = Object.keys(models);
        for (let k = 0; k < keys.length; k += 1) {
          if (modelNames.includes(keys[k])) {
            delete reg[keys[k]];
          }
        }
        return JSON.stringify(reg);
      });
      redis.sadd(model, regsToAdd, (error, response) => {
        if (error) {
          rollbar
            .error(
              `REDIS Registers not saved, key "${model}": \nRegisters: ${JSON.stringify(
                regsToAdd,
                null,
                2
              )}\nReason: ${error}\nRedis result: ${response}`
            )
            .useEvent(eventId);
          finishEvent && rollbar.finishEvent(eventId);
          return resolve(false);
        }
        if (!response) {
          rollbar
            .info(
              `REDIS Register already exists:\n${regsToAdd.map(reg =>
                JSON.stringify(JSON.parse(reg), null, 2)
              )}`
            )
            .useEvent(eventId);
          if (finishEvent) {
            rollbar.finishEvent(eventId);
          }
          return resolve(true);
        }
        finishEvent && rollbar.finishEvent(eventId);
        rollbar
          .info(`REDIS Created registers:\n${regsToAdd.map(reg => JSON.stringify(JSON.parse(reg), null, 2))}`)
          .useEvent(eventId);
        resolve(true);
      });
    });

  // Returning null || { found: Number, updated: Number }
  redis.update = (eventId, model, update, where) =>
    new Promise(async resolve => {
      const finishEvent = eventId == null;
      eventId = eventId == null ? rollbar.startEvent() : eventId;
      const members = await redis.find(eventId, model, where);

      if (!(update instanceof Object)) {
        rollbar.error(`REDIS Param update must be an object, model "${model}"\n\nUpdate:\n${update}`);
        finishEvent && rollbar.finishEvent(eventId);
        return resolve(null);
      }
      if (!members) {
        rollbar.error(
          `REDIS Error getting members for updating, model "${model}"\n\nWhere:\n${JSON.stringify(
            where,
            null,
            2
          )}`
        );
        finishEvent && rollbar.finishEvent(eventId);
        return resolve(null);
      }
      if (members.length === 0) {
        rollbar
          .warn(
            `REDIS Didn't found members for updating, model "${model}"\n\nWhere:\n${JSON.stringify(
              where,
              null,
              2
            )}`
          )
          .useEvent(eventId);
        finishEvent && rollbar.finishEvent(eventId);
        return resolve(0);
      }
      const updateKeys = Object.keys(update);
      let updated = 0;
      for (let k = 0; k < members.length; k += 1) {
        const oldMember = { ...members[k] };
        for (let m = 0; m < updateKeys.length; m += 1) {
          const field = updateKeys[m];
          if (update[field] instanceof Object) {
            if (update[field].$sumDate) {
              const { unit } = update[field].$sumDate;
              let { date, number } = update[field].$sumDate;
              date = typeof date === 'string' ? moment(oldMember[date]) : date; // Parsing for cols
              number = typeof number === 'string' ? oldMember[number] : number; // Parsing for cols
              members[k][field] = date.add(number, `${unit}s`);
            }
            continue;
          }
          members[k][field] = update[field];
        }
        updated += 1;
      }
      if (updated < members.length) {
        rollbar
          .warn(`REDIS Only will try to update ${updated} of ${members.length} members`)
          .useEvent(eventId);
      }
      const deleted = await redis.delete(eventId, model, where); // Must be sequential
      const created = await redis.create(eventId, model, members); // Must be sequential
      if (!deleted && !created) {
        rollbar.warn(`REDIS Update failed`).useEvent(eventId);
        finishEvent && rollbar.finishEvent(eventId);
        return resolve(null);
      }
      if (!deleted) {
        rollbar.warn(`REDIS Old members not deleted !! Please delete old documents`).useEvent(eventId);
      }
      if (!created) {
        rollbar.warn(`REDIS New members not created !! The old members are deleted ok`).useEvent(eventId);
        finishEvent && rollbar.finishEvent(eventId);
        return resolve(null);
      }
      rollbar.info(`Updated ${updated} / ${members.length} rows`).useEvent(eventId);
      finishEvent && rollbar.finishEvent(eventId);
      resolve({ found: members.length, updated });
    });
  return redis;
};

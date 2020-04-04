/* eslint-disable no-loop-func */
const object = require('./object');

/**
 * @typedef FlowValueFilter
 * @type {Object}
 * @property {Boolean} [$exists] - Checks whether value for field exists
 * @property {any} [$eq] - Is equal to
 * @property {Number} [$gt] - Is greater than
 * @property {Number} [$gte] - Is greater or equal to
 * @property {Number} [$lt] - Is less than
 * @property {Number} [$lte] - Is less or equal to
 * @property {any[]} [$in] - Is included in specified array
 * @property {any[]} [$nin] - Is not included specified array
 */

module.exports = (models, redis, rollbar) => {
  // First param must be a model name
  // Examples:
  // ('user', { id: 1 }, ['*', 'id', 'password'], ['userBotVersions'])
  const getInclude = (eventId, model, component, ...args) => {
    const finishEvent = eventId == null;
    eventId = eventId == null ? rollbar.startEvent() : eventId;
    const params = [];
    let index = -1;
    let lastModel = model;
    for (let k = 0; k < args.length; k += 1) {
      if (typeof args[k] === 'string') {
        lastModel = args[k];
        index += 1;
        const relations = models[model].relations[args[k]] || {};

        params[index] = {
          model: component === 'redis' ? args[k] : models[args[k]],
          as: args[k],
          required: component === 'redis' ? undefined : relations.innerJoin !== false
        };
        continue;
      }
      if (k === 0) {
        rollbar.error('flow.js: getInclude(): First arg must be string').useEvent(eventId);
      }
      if (Array.isArray(args[k])) {
        if (args[k][0] === '*') {
          params[index].attributes = args[k].slice(1);
        } else {
          params[index].include = getInclude(eventId, lastModel, component, ...args[k]);
        }
        continue;
      }
      if (args[k] instanceof Object) {
        switch (component) {
          case 'redis':
            params[index].where = args[k];
            break;
          case 'sequelize':
            params[index].where = object.sequelizeFilter(args[k]);
            break;
          default:
            params[index].where = args[k];
            break;
        }
        continue;
      }
      rollbar.warn(`Param ${k}: ${args[k]} was not used`).useEvent(eventId);
    }
    finishEvent && rollbar.finishEvent(eventId);

    return params;
  };

  /**
   * @typedef FlowUpdateReturn
   * @property {object} postgres - Postgres update info.
   * @property {Number} postgres.found - Found registers on postges.
   * @property {Number} postgres.updated - Updated registers on postges.
   * @property {Number} redis.found - Found registers on redis.
   * @property {Number} redis.updated - Updated registers on redis.
   */
  /**
   * Updates registers on redis and postgres.
   * @param {String} model - The name of the model you want to update
   * @param {object<String, Number>} update - An object where each key represents the field to be updated
   * @param {Object.<string, FlowValueFilter>} where - A searching object where each key represents a field.
   * @return {Promise<FlowUpdateReturn>} Promise.
   */
  const Update = (model, update, where) =>
    new Promise(resolve => {
      const eventId = rollbar.startEvent();
      const result = { postgres: null, redis: null };
      if (!models[model]) {
        rollbar.error(`SEQUELIZE Model "${model}" is not defined`).finishEvent(eventId);
        return resolve(result);
      }
      const sequelizeWhere = object.sequelizeFilter(where);
      const sequelizeUpdate = object.sequelizeUpdate(update);

      models[model]
        .update(sequelizeUpdate, { where: sequelizeWhere })
        .then(async quantity => {
          result.postgres = { found: quantity[0], updated: quantity[0] };
          rollbar.info(`SEQUEILZE Updated ${quantity} registers on model "${model}"`).useEvent(eventId);
          const updatedRegs = await redis.update(eventId, model, update, where);
          if (updatedRegs === null) {
            rollbar.finishEvent(eventId);
            result.redis = null;
            return resolve(result);
          }
          result.redis = updatedRegs;
          rollbar.finishEvent(eventId);
          resolve(result);
        })
        .catch(updateError => {
          const errorLog = `Errors: ${(updateError.errors &&
            updateError.errors.map(error => `\n  - ${error.message} (${error.type})`)) ||
            updateError}`;

          rollbar
            .error(`SEQUELIZE Could not update registers, model "${model}": \n\nError/s:\n${errorLog}`)
            .finishEvent(eventId);
          resolve(result);
        });
    });

  /**
   * @typedef FlowSaveReturn
   * @property {(null|boolean)} postgres - null: error, false: not found, true: saved
   * @property {(null|Boolean)} redis - null: error, false: not found, true: saved
   * @property {(null|Object[])} registers - null: error. If there's no error returns the array of saved registers
   */
  /**
   * Saves specified registers on postgres and redis
   * @param {String} model - The name of the model you want to update (Not necessary that it's defined on modelsDir)
   * @param {Object[]} registers - The register/s to save
   * @return {Promise<FlowSaveReturn>} Promise.
   */
  const Save = (model, registers) =>
    new Promise(resolve => {
      const eventId = rollbar.startEvent();
      const result = { postgres: null, redis: null, registers: null };
      if (!models[model]) {
        rollbar.error(`Model "${model}" is not defined on SEQUELIZE`).finishEvent(eventId);
        return resolve(result);
      }
      let method;
      if (Array.isArray(registers) && registers.length > 1) {
        method = 'bulkCreate';
      } else {
        method = 'create';
        registers = Array.isArray(registers) ? registers[0] : registers;
      }
      models[model][method](registers)
        .then(createdRegs => {
          createdRegs = Array.isArray(createdRegs) ? createdRegs : [createdRegs];
          createdRegs = createdRegs.map(reg => reg.dataValues);
          const stringRegs = createdRegs.map(reg => JSON.stringify(reg));
          result.postgres = true;
          result.registers = createdRegs;
          rollbar.info(`SEQUELIZE created register, model "${model}"`).useEvent(eventId);
          redis.sadd(model, stringRegs, (redisError, response) => {
            if (redisError || !response) {
              rollbar
                .error(
                  `REDIS Register/s not saved, model "${model}":
  Register/s: ${JSON.stringify(createdRegs, null, 2)}\nReason: ${redisError}\nRedis result: ${response}`
                )
                .finishEvent(eventId);
              return resolve(result);
            }
            result.redis = true;
            rollbar
              .info(`REDIS Created register/s:\n${JSON.stringify(createdRegs, null, 2)}`)
              .finishEvent(eventId);
            resolve(result);
          });
        })
        .catch(saveError => {
          const errorLog = `Errors: ${(saveError.errors &&
            saveError.errors.map(error => `\n  - ${error.message} (${error.type})`)) ||
            saveError}`;
          rollbar
            .error(
              `SEQUELIZE Register not saved, model "${model}": \n\nRegister/s:\n${JSON.stringify(
                registers,
                null,
                2
              )}\n\n${errorLog}`
            )
            .finishEvent(eventId);
          resolve(result);
        });
    });
  // Returning { postgres && redis: null (error) || false (not found) || true (deleted) }
  /**
   * @typedef FlowDeleteReturn
   * @property {Boolean|null} postgres - null: error, false: not found, true: deleted on postgres.
   * @property {Boolean|null} redis - null: error, false: not found, true: deleted on redis.
   */
  /**
   * Updates registers on redis and postgres.
   * @param {String} model - The name of the model you want to update
   * @param {Object.<string, FlowValueFilter>} where - A searching object where each key represents a field.
   * @return {Promise<FlowDeleteReturn>} Promise.
   */
  const Delete = (model, where = {}) =>
    new Promise(resolve => {
      const result = { postgres: null, redis: null };
      const eventId = rollbar.startEvent();
      if (!models[model]) {
        rollbar.error(`SEQUELIZE Model "${model}" is not defined`).finishEvent(eventId);
        return resolve(result);
      }

      const sequelizeWhere = object.sequelizeFilter(where);

      models[model]
        .findAll({ where: sequelizeWhere })
        .then(async registers => {
          result.postgres = true;
          if (registers.length === 0) {
            result.postgres = false;
            rollbar
              .info(
                `SEQUELIZE Registers not found, model "${model}"\n\nWhere:\n${JSON.stringify(where, null, 2)}`
              )
              .useEvent(eventId);
          } else {
            rollbar
              .info(
                `SEQUELIZE Found registers for deleting model "${model}"\n\nWhere:\n${JSON.stringify(
                  where,
                  null,
                  2
                )}`
              )
              .useEvent(eventId);
          }

          const { relations } = models[model];
          if (relations) {
            const relModels = Object.keys(relations);
            const deletes = [];
            for (let k = 0; k < relModels.length; k += 1) {
              const relation = relations[relModels[k]];
              if (!relation.type.toLowerCase().includes('has')) {
                continue;
              }

              const thisKeys = [];
              for (let m = 0; m < registers.length; m += 1) {
                thisKeys.push(registers[m].dataValues[relation.thisKey]);
              }
              if (thisKeys.length > 0) {
                deletes.push(module.exports.delete(relModels[k], { [relation.otherKey]: { $in: thisKeys } }));
              }
            }
            if (deletes.length > 0) {
              await Promise.all(deletes);
            }
          }
          const destroys = [];
          for (let k = 0; k < registers.length; k += 1) {
            const register = registers[k].dataValues;
            destroys.push(registers[k].destroy({ cascade: true, force: true }));
            destroys[k]
              .then(() => {
                rollbar
                  .info(`SEQUELIZE Deleted register:\n${JSON.stringify(register, null, 2)}`)
                  .useEvent(eventId);
              })
              .catch(delError => {
                rollbar
                  .error(
                    `SEQUELIZE Could not delete register:\n${JSON.stringify(register, null, 2)}\n\nError`,
                    delError
                  )
                  .useEvent(eventId);
              });
          }
          await Promise.all(destroys);

          result.redis = await redis.delete(eventId, model, where);
          rollbar.finishEvent(eventId);
          resolve(result);
        })
        .catch(saveError => {
          const errorLog = `Errors: ${(saveError.errors &&
            saveError.errors.map(error => `\n  - ${error.message} (${error.type})`)) ||
            saveError}`;
          rollbar
            .error(
              `SEQUELIZE Register not deleted, model "${model}": \n\nWhere options:\n${JSON.stringify(
                where,
                null,
                2
              )}\n\n${errorLog}`
            )
            .finishEvent(eventId);
          resolve(result);
        });
    });

  const filterAttributes = (registers, attributes) => {
    if (!attributes) {
      return registers;
    }
    const newRegisters = [];
    const modelNames = Object.keys(models);
    for (let n = 0; n < registers.length; n += 1) {
      const keys = Object.keys(registers[n]);
      const newObject = {};
      for (let k = 0; k < keys.length; k += 1) {
        if (attributes.includes(keys[k]) || modelNames.includes(keys[k])) {
          newObject[keys[k]] = registers[n][keys[k]];
        }
      }
      newRegisters.push(newObject);
    }
    return newRegisters;
  };

  // Returning null (error) || [] (not found) || [...] (found)
  /**
   * Gets registers on redis or in postgres if there is no registers on postgres.
   * @param {String} model - The name of the model you want to update
   * @param {Object.<string, FlowValueFilter>} where - A searching object where each key represents a field.
   * @param {String[]} attributes - 'all' for all, Array of strings for indicating returning attributes.
   * @param {any} args - Include others models here.
   * @return {Promise<(null|any[])>} Promise.
   */
  const Get = (model, where, attributes, ...args) =>
    new Promise(async resolve => {
      attributes = attributes === 'all' ? undefined : attributes;
      const eventId = rollbar.startEvent();

      let include = getInclude(eventId, model, 'redis', ...args);

      if (!models[model]) {
        rollbar.error(`Model "${model}" is not defined on SEQUELIZE`).finishEvent(eventId);
        return resolve(null);
      }

      const members = await redis.find(eventId, model, where, ...include);
      let found = true;
      if (!members) {
        found = false;
        rollbar.error('REDIS Could not find members, searching on sequelize...').useEvent(eventId);
      }
      if (members && members.length === 0) {
        found = false;
        rollbar
          .info(
            `REDIS Members not found on model "${model}", searching on SEQUELIZE\n\nWhere:\n${JSON.stringify(
              where,
              null,
              2
            )}`
          )
          .useEvent(eventId);
      }
      if (found) {
        resolve(filterAttributes(members, attributes));
        rollbar.finishEvent(eventId);
      } else {
        where = object.sequelizeFilter(where);
        include = getInclude(eventId, model, 'sequelize', ...args);

        let registers = await models[model].find(eventId, where, undefined, include);

        if (!registers) {
          rollbar.finishEvent(eventId);
          return resolve(null);
        }
        registers = filterAttributes(registers, attributes);
        resolve(registers);
        if (registers.length > 0) {
          await redis.create(eventId, model, registers);
        }
        rollbar.finishEvent(eventId);
      }
    });
  return { update: Update, save: Save, delete: Delete, get: Get };
};

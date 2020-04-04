const Sequelize = require('sequelize');
const fs = require('fs');
const path = require('path');

const models = {};

module.exports = (dirname = __dirname, url, rollbar) => {
  const sequelize = new Sequelize(url);

  fs.readdirSync(dirname)
    .filter(file => file.indexOf('.') !== 0 && file !== 'index.js' && file.slice(-3) === '.js')
    .forEach(file => {
      const model = sequelize.import(path.join(dirname, file));
      models[model.name] = model;
    });
  const find = modelName => (eventId, where, attributes, include) =>
    new Promise(resolve => {
      const finishEvent = eventId == null;
      eventId = eventId == null ? rollbar.startEvent() : eventId;
      models[modelName]
        .findAll({
          where,
          attributes,
          include
        })
        .then(registers => {
          if (registers.length > 0) {
            rollbar.info(`SEQUELIZE Found register/s for model ${modelName}`).useEvent(eventId);
          } else {
            finishEvent && rollbar.finishEvent(eventId);
            rollbar.info(`SEQUELIZE Not found registers/s for model ${modelName}`).useEvent(eventId);
            return resolve([]);
          }
          finishEvent && rollbar.finishEvent(eventId);
          resolve(
            registers.map(register => {
              const reg = register.dataValues;
              return reg;
            })
          );
        })
        .catch(getError => {
          const errorLog = `Errors: ${(getError.errors &&
            getError.errors.map(error => `\n  - ${error.message} (${error.type})`)) ||
            getError}`;
          rollbar
            .error(
              `SEQUELIZE Error finding, model "${modelName}": \n\nWhere options:\n${JSON.stringify(
                where,
                null,
                2
              )}\n\n${errorLog}`
            )
            .useEvent(eventId);
          finishEvent && rollbar.finishEvent(eventId);
          resolve(null);
        });
    });

  Object.keys(models).forEach(modelName => {
    if (models[modelName].relations) {
      const modelNames = Object.keys(models[modelName].relations);
      for (let k = 0; k < modelNames.length; k += 1) {
        const currRelation = models[modelName].relations[modelNames[k]];
        if (!models[modelName][currRelation.type]) {
          rollbar.error(`Invalid relation "${currRelation.type}"`);
          continue;
        }
        models[modelName][currRelation.type](models[modelNames[k]], { as: modelNames[k] });
      }
    }
    models[modelName].find = find(modelName);
  });
  return models;
};

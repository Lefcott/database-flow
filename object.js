const sequelize = require('sequelize');
const { check, filter, compareN } = require('@lefcott/filter-json');

const sequelizeConditions = conditions => {
  conditions = Array.isArray(conditions) ? conditions : [conditions];
  conditions = conditions.map(Condition => {
    const condition = JSON.parse(JSON.stringify(Condition));
    if (condition) {
      delete condition.$transform;
    }
    return condition;
  });
  for (let n = 0; n < conditions.length; n += 1) {
    const condition = conditions[n];
    const keys = Object.keys(condition);
    for (let k = 0; k < keys.length; k += 1) {
      const key = keys[k];
      if (key[0] === '$') {
        const op = sequelize.Op[key.substring(1)];
        if (!op) {
          console.warn(`object.js: Ignored operator "${key}": it doesn't exist on sequelize.Op`);
          delete conditions[n][key];
          continue;
        }
        conditions[n][op] = condition[key];
        delete conditions[n][key];
      }
    }
  }
  return conditions;
};

const sequelizeFilter = (base = {}) => {
  const and = [];
  const noOpObject = {};
  Object.keys(base).forEach(key => {
    if (base[key]) {
      if (key[0] === '$') {
        and.push(sequelize[key.substring(1)](...sequelizeConditions(base[key])));
      } else {
        [noOpObject[key]] = sequelizeConditions(base[key]);
      }
    }
  });

  and.push(noOpObject);
  return sequelize.and(...and);
};

const sequelizeUpdate = (Base = {}) => {
  const keys = Object.keys(Base);
  const base = {};
  for (let k = 0; k < keys.length; k += 1) {
    const values = { ...Base[keys[k]] };
    if (Base[keys[k]] instanceof Object) {
      if (values.$sumDate) {
        const { unit } = values.$sumDate;
        let { date, number } = values.$sumDate;
        date = typeof date === 'string' ? `"${date}"` : `TIMESTAMP '${date.format()}'`; // Parsing for cols
        number = typeof number === 'string' ? `"${number}"` : number; // Parsing for cols
        base[keys[k]] = sequelize.literal(`${date} + interval '1 ${unit}' * ${number}`);
      }
      continue;
    }
    base[keys[k]] = Base[keys[k]];
  }
  return base;
};

module.exports = { check, filter, compare: compareN, sequelizeFilter, sequelizeUpdate };

const Rollbar = require('rollbar-grouping');
const path = require('path');
const stack = require('method-stack');

const getModels = require('./models');
const getRedis = require('./redis');
const getFlow = require('./flow');

/**
 * Initializate Database-Flow:
 * @param {object} Config - Configuration for Database Flow.
 * @param {String} [Config.modelsDir] - Absolute path of folder containing models. Default to dirname of caller.
 * @param {Function} [Config.logging] - Falsy value for no logging. For logging: method like console.log or 'rollbar-grouping' library object.
 * @param {object} Config.redis - Redis configuration.
 * @param {String} Config.redis.url - URL in format "redis://user:pass&#64;host:port".
 * @param {Boolean} [Config.redis.helloMessage=true] - true for showing a message when redis is connected.
 * @param {object} Config.sequelize - Sequelize configuration.
 * @param {String} Config.sequelize.url - URL in format "postgres://user:pass&#64;host:port/database". Not necessary when passing connection param.
 * @param {object} Config.sequelize.connection - Connection config. Not necessary when passing url param.
 * @param {String} Config.sequelize.connection.user - Database user
 * @param {String} Config.sequelize.connection.port - Database port
 * @param {String} Config.sequelize.connection.pass - Database pass
 * @param {String} Config.sequelize.connection.host - Database host
 * @param {String} Config.sequelize.connection.database - Database name
 */
module.exports = Config => {
  const config = {
    ...Config,
    logging: Config.logging
      ? (Rollbar.isRollbarGroupingObject(Config.logging) && Config.logging) ||
        Rollbar({ mock: true, secondLogging: Config.logging })
      : () => {}
  };
  config.modelsDir = config.modelsDir || path.dirname(stack.getCaller().file);
  config.redis.helloMessage = config.redis.helloMessage !== false;
  let databaseUrl = config.sequelize.url;
  if (typeof databaseUrl !== 'string') {
    const { user, pass, host, port, database } = config.sequelize.connection;
    databaseUrl = `postgres://${user}:${pass}@${host}:${port}/${database}`;
  }
  const models = getModels(config.modelsDir, databaseUrl, config.logging);
  const redis = getRedis(config.redis.url, config.redis.helloMessage, models);
  return {
    ...getFlow(models, redis, config.logging),
    models,
    redis
  };
};

# database-flow

Fast access implementation with redis and postgres

Feel free to open new issues [here](https://github.com/lefcott19/database-flow/issues)!

### Installation:

```
npm install --save database-flow
```

### Initialization Examples:

1. Logging with console.log

```js
const flow = require('database-flow')({
  modelsDir: `${__dirname}/database/models`,
  logging: console.log,
  redis: { url: process.env.REDISCLOUD_URL, helloMessage: true },
  sequelize: {
    username: 'user',
    password: '12234',
    database: 'database',
    host: '127.0.0.1',
    dialect: 'postgres',
    timezone: 'America/Argentina/Buenos_aires',
    dialectOptions: {
      useUTC: false
      ssl: {
        rejectUnauthorized: false,
      }
    },
    logging: console.log
  }
});
```

2. You can log with [rollbar-grouping](https://www.npmjs.com/package/rollbar-grouping) if you want to group all the logs of an event.

```js
const rollbar = require('rollbar-grouping')(...);
const flow = require('database-flow')({
  modelsDir: `${__dirname}/database/models`,
  logging: rollbar,
  redis: { url: process.env.REDISCLOUD_URL, helloMessage: true },
  sequelize: {
    username: 'user',
    password: '12234',
    database: 'database',
    host: '127.0.0.1',
    dialect: 'postgres',
    timezone: 'America/Argentina/Buenos_aires',
    dialectOptions: {
      useUTC: false
      ssl: {
        rejectUnauthorized: false,
      }
    },
    logging: console.log
  }
});
```

### Usage Example:

```js
const example = async () => {
  await flow.save('user', {
    name: 'username',
    pass: '1234',
    email: 'example@example.com',
    followers: 15000,
    famous: false
  });
  //                MODEL        UPDATE                   WHERE                   
  await flow.update('user', { famous: true }, { followers: { $gt: 10000 } });
  const famousUsers = await flow.get('user', { famous: true }, ['name', 'email']);
  console.log(`These are the famous users:\nJSON.stringify(famousUsers, null, 2)`);
};
example();
```

### Available options for WHERE value:
```js
const where = {
  $exists: true, // The value must exist
  $eq: 3, // The value must be equal to 3
  $gt: 2, // The value must be greater than 2
  $gte: 3, // The value must be greater or equal to 2
  $lt: 5, // The value must be less than 5
  $lte: 3, // The value must be less or equal to 3
  $in: [1, 2, 3, 'hello'], // The value must be 1, 2, 3 or 'hello'
  $nin: [4, 5, 6], // The value must not be 4, 5 or 6
};
flow.get('user', { someField: where });
// where can also be an exact value like 1, 'hello', null...
```

### Available options for UPDATE object:
#### Sum and subtract specified numbers
```js
const update = {
  $sum: 5, // Will sum 5 to the field value
  $subtract: 6, // Will subtract 6 to the field value
};
flow.update('user', { someField: update }, {});
// update can also be an exact value like 1, 'hello', null...
```

#### Sum and subtract numbers from other fields
```js
const update = {
  $sum: 'field1', // Will sum the value of the field 'field1'
  $subtract: 'field2', // Will subtract the value of the field 'field1'
};
flow.update('user', { someField: update }, {});
```

#### Dates: Sum and subtract specified time
```js
const moment = require('moment');
const update = {
  $sumDate: { date: moment(), number: 15, unit: 'day' }, // Will sum 15 days to current date
};
flow.update('user', { someField: update }, {});
```

#### Dates: Sum and subtract time from other field
```js
const moment = require('moment');
const update = {
  $sumDate: { date: 'someField', number: 'field1', unit: 'day' }, // Will sum the time of the field 'field1' in field 'someField'
};
flow.update('user', { someField: update }, {});
```
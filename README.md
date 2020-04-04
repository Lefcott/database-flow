# database-flow

Fast access implementation with redis and postgres

Feel free to open new issues [here](https://github.com/lefcott19/database-flow/issues)!

### Installation:

```
npm install --save database-flow
```

### Initialization Examples:

1.

```js
const flow = require('database-flow')({
  modelsDir: `${__dirname}/database/models`,
  logging: console.log,
  redis: { url: process.env.REDISCLOUD_URL, helloMessage: true },
  sequelize: { url: process.env.DATABASE_URL }
});
```

2. You can log with [rollbar-grouping](https://www.npmjs.com/package/rollbar-grouping) if you want to group all the logs of an event.

```js
const rollbar = require('rollbar-grouping')(...);
const flow = require('database-flow')({
  modelsDir: `${__dirname}/database/models`,
  logging: rollbar,
  redis: { url: process.env.REDISCLOUD_URL, helloMessage: true },
  sequelize: { connection: { user: 'user', pass: 'pass', host: 'host', port: '1234', database: 'database' } }
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
  await flow.update('user', { famouse: true }, { followers: { $gt: 10000 } });
  const famousUsers = await flow.get('user', { famous: true }, ['name', 'email']);
  console.log(`These are the famous users:\nJSON.stringify(famousUsers, null, 2)`);
};
example();
```

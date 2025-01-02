const Redis = require('ioredis');
require('dotenv').config();

const redisExternalUrl = process.env.REDIS_EXTERNAL_URL;

const redis = new Redis(redisExternalUrl, {
    tls: {
        rejectUnauthorized: false
    }
});

redis.on('connect', () => {
    console.log('Connected to Redis!');
});

redis.on('error', (err) => {
    console.error('Redis Client Error:', err);
});

redis.ping().then(result => {
    console.log('Redis PING result:', result);
}).catch(err => {
    console.error('Redis PING failed:', err);
});

module.exports = { redis }
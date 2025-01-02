const swaggerAutogen = require('swagger-autogen')();

const doc = {
    info: {
        title: 'URL Shortner Application',
        description: 'This application is used to create short url for any type of urls and while clicking on it we will record the user analytics.'
    },
    host: 'localhost:3000',
    Schema: ["http"]
};

const outputFile = './swagger-output.json';
const routes = ['./server.js'];

/* NOTE: If you are using the express Router, you must pass in the 'routes' only the 
root file where the route starts, such as index.js, app.js, routes.js, etc ... */

swaggerAutogen(outputFile, routes, doc);
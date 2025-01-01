const express = require("express");
const session = require("express-session");
const app = express();
const mongoose = require("mongoose");
const passport = require("passport");
const uniqid = require("uniqid");
const { isAuthenticated } = require("./middleware");
const { shortUrlInfo, osTypeModel, deviceTypeModel } = require("./models/shortUrl");
const { rateLimit } = require("express-rate-limit");
const geoIp = require("geoip-lite");
const UAParser = require('ua-parser-js');
const cors = require("cors");

const redis = require("redis");
const redisClient = redis.createClient();

redisClient.on('error', (err) => console.error('Redis Client Error', err));

(async () => {
    await redisClient.connect();
})();

require('./auth');

mongoose.connect("mongodb://localhost:27017/shortner");

app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true,
}));

app.use(express.json());
require('dotenv').config();

const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minutes
    max: 20, // limit each IP to 20 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});

app.use(limiter);

app.use(
    session({
        secret: 'sessecret5234234',
        resave: false,
        saveUninitialized: true,
    })
);
app.use(passport.initialize());
app.use(passport.session());

app.get('/', (req, res) => {
    const loginLink = `<a href="/auth/google">Sign in with Google</a>`;
    res.send(loginLink);
});

app.get(
    '/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
        // Successful login, redirect to profile
        console.log(req);
        res.redirect('http://localhost:5173/home');
    }
);

app.get("/api/home", isAuthenticated, (req, res) => {
    res.status(200).json({ message: "Welcome to the Shortner!" });
});


app.get("/api/demo", (req, res) => {
    res.send("Hello welcome , testing the get api" + uniqid());
})

// app.post("/api/shorten", isAuthenticated, async (req, res) => {
//     try {
//         const { fullUrl, customAlias, topic } = req.body;
//         const newAlias = customAlias !== "" ? customAlias : uniqid();
//         const shortUrl = `http://localhost:3000/api/shorten/${newAlias}`
//         const userId = req.user?._id;
//         const userIp = req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;

//         if (!shortUrl) {
//             throw new Error('Short URL cannot be null or empty');
//         }

//         console.log(shortUrl + "===============");
//         const data = {
//             fullUrl,
//             topic,
//             userId,
//             userIp,
//             alias: newAlias,
//             urls: [{
//                 shortUrl
//             }]
//         }

//         const shortenUrl = await shortUrlInfo.create(data);
//         console.log(JSON.stringify(shortenUrl));
//         const response = {
//             shortUrl: shortenUrl.urls[0].shortUrl,
//             createdAt: shortenUrl.createdAt,
//         }

//         res.status(201).json({ response });
//     } catch (e) {
//         console.log(e);
//         res.status(404).json(e);
//     }
// });

app.post("/api/shorten", isAuthenticated, async (req, res) => {
    try {
        const { fullUrl, customAlias, topic } = req.body;
        const userId = req.user?._id;
        const userIp = req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;

        if (!fullUrl) {
            return res.status(400).json({ error: 'Full URL is required' });
        }

        const newAlias = customAlias || uniqid();
        const shortUrl = `http://localhost:3000/api/shorten/${newAlias}`;

        const existingUrl = await shortUrlInfo.findOne({ shortUrl });
        if (existingUrl) {
            return res.status(409).json({ error: 'This short URL already exists. Please try again.' });
        }

        const data = {
            fullUrl,
            topic,
            userId,
            userIp,
            alias: newAlias,
            shortUrl
        };

        const shortenUrl = await shortUrlInfo.create(data);

        const response = {
            shortUrl: shortenUrl.shortUrl,
            createdAt: shortenUrl.createdAt,
        };

        res.status(201).json(response);
    } catch (e) {
        res.status(404).json(e);
    }
});

app.get("/api/shorten", async (req, res) => {
    try {
        const response = await shortUrlInfo.find()
            .populate({
                path: "osAnalytics",
                select: "osName uniqueClicks uniqueUsers"
            })
            .populate({
                path: "deviceAnalytics",
                select: "deviceName uniqueClicks uniqueUsers"
            })
        res.status(200).json(response);
    } catch (e) {
        console.log(e);
        res.status(404).json({ error: e.message })
    }
})

const updateAnalytics = async (req, alias) => {
    try {
        const shortUrls = await shortUrlInfo.findOne({ alias });
        const userIp = req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];
        const parser = new UAParser(userAgent);
        const osName = parser.getOS().name;

        shortUrls.totalClicks++;
        shortUrls.clicksByDate.push({ date: new Date(), clickCount: shortUrls.totalClicks });
        if (shortUrls.userIp === userIp) {
            shortUrls.uniqueUsers++;
        }

        let osTypeAnalytics;
        if (shortUrls.osAnalytics) {
            osTypeAnalytics = await osTypeModel.findById(shortUrls.osAnalytics);
        }

        shortUrls.osAnalytics = shortUrls.osAnalytics || "";

        if (!shortUrls.osAnalytics) {
            osTypeAnalytics = new osTypeModel({
                osName: osName
            });
        } else {
            osTypeAnalytics.uniqueClicks++;
            if (shortUrls.userIp === userIp) {
                osTypeAnalytics.uniqueUsers++;
            }
        }

        shortUrls.osAnalytics = osTypeAnalytics._id;
        await osTypeAnalytics.save();

        let deviceTypeAnalytics;
        if (shortUrls.deviceAnalytics) {
            deviceTypeAnalytics = await deviceTypeModel.findById(shortUrls.deviceAnalytics);
        }

        shortUrls.deviceAnalytics = shortUrls.deviceAnalytics || "";

        const deviceName = parser.getDevice().type || 'desktop';

        if (!shortUrls.deviceAnalytics) {
            deviceTypeAnalytics = new deviceTypeModel({
                deviceName
            });
        } else {
            deviceTypeAnalytics.uniqueClicks++;
            if (shortUrls.userIp === userIp) {
                deviceTypeAnalytics.uniqueUsers++;
            }
        }

        shortUrls.deviceAnalytics = deviceTypeAnalytics._id;

        await deviceTypeAnalytics.save();

        await shortUrls.save();
    } catch (e) {
        console.error("Error updating analytics:", e);
        // res.status(404).json(e);
    }
}

app.get("/api/shorten/:alias", async (req, res) => {
    try {
        const shortUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        const cachedFullUrl = await redisClient.get(shortUrl);
        const alias = req.params.alias;

        if (cachedFullUrl) {
            console.log("cache hit for shorUrl", shortUrl);
            updateAnalytics(req, alias);
            return res.status(302).redirect(cachedFullUrl);
        }

        const shortUrls = await shortUrlInfo.findOne({ alias });

        if (shortUrls === null)
            return res.sendStatus(404);

        console.log("cache miss for shortUrl");

        await redisClient.setEx(shortUrl, 300, shortUrls.fullUrl);

        await updateAnalytics(req, alias);

        res.status(302).redirect(shortUrls.fullUrl);
    } catch (e) {
        console.log(e)
        res.status(404).json(e);
    }
})


app.get("/api/analytics/:alias", async (req, res) => {
    try {
        const alias = req.params.alias;
        const shortUrl = await shortUrlInfo.findOne({ alias })
            .populate({
                path: "osAnalytics",
                select: "osName uniqueClicks uniqueUsers"
            })
            .populate({
                path: "deviceAnalytics",
                select: "deviceName uniqueClicks uniqueUsers"
            });
        const response = {
            totalClicks: shortUrl.totalClicks,
            uniqueUsers: shortUrl.uniqueUsers,
            clicksByDate: shortUrl.clicksByDate,
            osType: shortUrl.osAnalytics,
            deviceType: shortUrl.deviceAnalytics
        }

        res.status(200).json(response);
    } catch (e) {
        res.status(404).json(e);
    }
})

app.get("/api/analytics/topic/:topic", async (req, res) => {
    try {
        const topic = req.params.topic;
        const shortUrls = await shortUrlInfo.find({ topic });

        const urls = shortUrls.map(s => ({
            urls: [{
                shortUrl: s.shortUrl,
                totalClicks: s.totalClicks,
                uniqueUsers: s.uniqueUsers
            }]
        }))

        const reducedResponse = shortUrls.reduce((total, click) => {
            total.totalClicks += click.totalClicks;
            total.uniqueUsers += click.uniqueUsers;
            total.clicksByDate.push(click.clicksByDate);
            return total;
        }, { totalClicks: 0, uniqueUsers: 0, clicksByDate: [] });

        const response = {
            totalClicks: reducedResponse.totalClicks,
            uniqueUsers: reducedResponse.uniqueUsers,
            clicksByDate: reducedResponse.clicksByDate,
            urls: urls
        }

        res.status(200).json(response);
    } catch (e) {
        res.status(404).json(e);
    }
})

app.get("/api/overallAnalytics", async (req, res) => {
    try {
        const shortUrls = await shortUrlInfo.find()
            .populate({
                path: "osAnalytics",
                select: "osName uniqueClicks uniqueUsers"
            })
            .populate({
                path: "deviceAnalytics",
                select: "deviceName uniqueClicks uniqueUsers"
            })

        const reducedResponse = shortUrls.reduce((total, click) => {
            total.totalClicks += click.totalClicks;
            total.uniqueUsers += click.uniqueUsers;
            total.clicksByDate.push(click.clicksByDate);
            total.osAnalytics.push(click.osAnalytics);
            total.deviceAnalytics.push(click.deviceAnalytics);
            return total;
        }, { totalClicks: 0, uniqueUsers: 0, clicksByDate: [], osAnalytics: [], deviceAnalytics: [] });

        const response = {
            totalUrls: shortUrls.length,
            totalClicks: reducedResponse.totalClicks,
            uniqueUsers: reducedResponse.uniqueUsers,
            clicksByDate: reducedResponse.clicksByDate,
            osType: reducedResponse.osAnalytics,
            deviceType: reducedResponse.deviceAnalytics
        }
        console.log("-------------------");
        console.log(response);
        res.status(200).json(response);
    } catch (e) {
        res.status(404).json(e.message);
    }
})


app.listen(process.env.PORT || 3000, () => {
    console.log("server started in port 3000");
});
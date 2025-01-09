const express = require("express");
const session = require("express-session");
const app = express();
const mongoose = require("mongoose");
const uniqid = require("uniqid");
const { shortUrlInfo, osTypeModel, deviceTypeModel } = require("./models/shortUrl");
const { rateLimit } = require("express-rate-limit");
const geoIp = require("geoip-lite");
const UAParser = require('ua-parser-js');
const cors = require("cors");
require('dotenv').config();
const { userModel } = require("./models/shortUrl");

const swaggerUi = require("swagger-ui-express")
const swaggerFile = require('./swagger-output.json');
const { redis } = require("./redis");
const MongoStore = require("connect-mongo");

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

async function connectToMongoDB() {
    try {
        await mongoose.connect(process.env.MONGO_URL, {
            serverSelectionTimeoutMS: 30000, // 30 seconds
        });
        console.log('Connected to MongoDB successfully');
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error.message);
        process.exit(1);
    }
}

mongoose.connection.on('connected', () => {
    console.log('Mongoose connection established to MongoDB.');
});

mongoose.connection.on('error', (err) => {
    console.error('Mongoose connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
    console.log('Mongoose connection to MongoDB disconnected.');
});

connectToMongoDB();
app.set('trust proxy', 1);


app.use(cors({
    origin: process.env.frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());


const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minutes
    max: 20, // limit each IP to 20 requests per windowMs
    message: 'Too many requests from this IP, please try again later'
});

app.use(limiter);

app.use(
    session({
        secret: 'sessecret5234234',
        resave: false,
        saveUninitialized: false,
        store: MongoStore.create({
            mongoUrl:process.env.MONGO_URL,
            ttl: 60 * 60 * 24
        }),
        cookie: {
            secure: true,
            maxAge: 1000 * 60 * 60 * 24,
            httpOnly: true,
            sameSite: 'none',
        },
    })
);

passport.use(new GoogleStrategy({
        clientID: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        callbackURL: process.env.CALLBACK_URL,
        proxy: true
    },
    async (accessToken, refreshToken, profile, done) => {
        try {
            let User = await userModel.findOne({ googleId: profile.id });
            if (!User) {
                User = await userModel.create({
                    googleId: profile.id,
                    email: profile.emails[0].value,
                    name: profile.displayName,
                })
            }
            console.log("inside passport auth success");
            return done(null, User);
        } catch (e) {
            return done(e, null);
        }
    }
))

passport.serializeUser((user, done) => {
    return done(null, user._id || user.id);
})

passport.deserializeUser(async (user, done) => {
    try {
        const user1 = await userModel.findById(user._id);
        return done(null, user1);
    } catch (error) {
        return done(error, null);
    }
})


app.use(passport.initialize());
app.use(passport.session());

app.get(
    '/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] ,prompt: 'select_account'})
);

app.get(
    '/auth/google/callback',
    passport.authenticate('google', {
        failureRedirect: process.env.frontendUrl,
        session: true,
        failureMessage: true
    }),
    (req, res) => {
        console.log("inside google callback entry");
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.redirect(process.env.frontendUrl);
            }
            res.redirect(process.env.frontendUrl + "/home");
        });
    }
);

const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    console.log('Authentication failed:', {
        session: !!req.session,
        user: !!req.user,
        isAuthenticated: req.isAuthenticated()
    });
    res.status(401).json({ 
        error: 'Unauthorized',
        redirectUrl: process.env.frontendUrl 
    });
};

const updateAnalytics = async (req, alias) => {
    try {
        const shortUrls = await shortUrlInfo.findOne({ alias });
        if (!shortUrls) {
            throw new Error('Short URL not found');
        }
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
        // console.error("Error updating analytics:", e);
        res.status(404).json(e);
    }
}

app.post("/api/shorten",isAuthenticated, async (req, res) => {
    try {
        console.log("inside post content");
        const { fullUrl, customAlias, topic } = req.body;
        const userId = req.user?._id;
        const userIp = req.ips.length ? req.ips[0] : req.ip;
        
        if (!fullUrl) {
            return res.status(400).json({ error: 'Full URL is required' });
        }

        const newAlias = customAlias || uniqid();
        const shortUrl = `https://shortner-app.onrender.com/api/shorten/${newAlias}`;

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
        console.log("successfully added shorturl content in db");
        res.status(201).json(response);
    } catch (e) {
        res.status(404).json(e);
    }
});

app.get("/api/shorten", isAuthenticated,async (req, res) => {
    try {
        // console.log("fetching content data success")
        const userId = req.user?._id;
        const response = await shortUrlInfo.find({userId})
            .populate({
                path: "osAnalytics",
                select: "osName uniqueClicks uniqueUsers"
            })
            .populate({
                path: "deviceAnalytics",
                select: "deviceName uniqueClicks uniqueUsers"
            })
        // console.log("fetching content data success")
        res.status(200).json(response);
    } catch (e) {
        // console.log(e);
        res.status(404).json({ error: e.message })
    }
})



app.get("/api/shorten/:alias", isAuthenticated, async (req, res) => {
    try {
        const shortUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        const cachedFullUrl = await redis.get(shortUrl);
        const alias = req.params.alias;

        if (cachedFullUrl) {
            // console.log("cache hit for shorUrl", shortUrl);
            updateAnalytics(req, alias);
            return res.status(302).redirect(cachedFullUrl);
        }

        const shortUrls = await shortUrlInfo.findOne({ alias });

        if (shortUrls === null)
            return res.sendStatus(404);

        // console.log("cache miss for shortUrl");

        await redis.set(shortUrl, shortUrls.fullUrl, "EX", 300);

        await updateAnalytics(req, alias);

        res.status(302).redirect(shortUrls.fullUrl);
    } catch (e) {
        // console.log(e)
        res.status(404).json(e);
    }
})


app.get("/api/analytics/:alias", isAuthenticated, async (req, res) => {
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

app.get("/api/analytics/topic/:topic", isAuthenticated, async (req, res) => {
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

app.get("/api/overallAnalytics", isAuthenticated, async (req, res) => {
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
        res.status(200).json(response);
    } catch (e) {
        res.status(404).json(e.message);
    }
})


app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerFile))


app.listen(process.env.PORT || 3000, () => {
    console.log("server started in port 3000");
});
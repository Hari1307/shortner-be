const passport = require("passport");
const { userModel } = require("./models/shortUrl");

const gStrategy = require("passport-google-oauth20").Strategy;

require('dotenv').config();
gStrategy.Strategy
passport.use(new gStrategy(
    {
        clientID: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        callbackURL: process.env.CALLBACK_URL
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
            done(null, User);
        } catch (e) {
            done(e, null);
        }
    }
))

passport.serializeUser((user, done) => {
    done(null, user.id);
})

passport.deserializeUser((user, done) => {
    done(null, user);
})


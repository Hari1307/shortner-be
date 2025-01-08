const { Schema, model, } = require("mongoose");

const userSchema = new Schema({
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    name: { type: String, require: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
})

const userModel = model("users", userSchema);

const shortUrlInfoSchema = new Schema({
    fullUrl: { type: String, required: true },
    shortUrl: { type: String, required: true },
    totalClicks: { type: Number, default: 0 },
    uniqueUsers: { type: Number, default: 0 },
    topic: { type: String },
    alias: { type: String, unique: true, required: true },
    createdAt: { type: Date, default: Date.now },
    userIp: { type: String, required: true },
    userId: { ref: "users", required: true, type: Schema.Types.ObjectId },
    clicksByDate: [
        {
            date: { type: Date },
            clickCount: { type: Number, default: 0 },
        },
    ],
    osAnalytics: { type: Schema.Types.ObjectId, ref: 'osTypes' },
    deviceAnalytics: { type: Schema.Types.ObjectId, ref: 'deviceTypes' }
});

const osTypeSchema = new Schema([{
    osName: { type: String },
    uniqueClicks: { type: Number, default: 1 },
    uniqueUsers: { type: Number, default: 1 },
}])

const deviceTypeSchema = new Schema([{
    deviceName: { type: String },
    uniqueClicks: { type: Number, default: 1 },
    uniqueUsers: { type: Number, default: 1 },
}])


const shortUrlInfo = model("shortUrlInfos", shortUrlInfoSchema);
const osTypeModel = model("osTypes", osTypeSchema);
const deviceTypeModel = model("deviceTypes", deviceTypeSchema);

module.exports = { userModel, shortUrlInfo, osTypeModel, deviceTypeModel }
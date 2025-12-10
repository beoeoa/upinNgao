const mongoose = require('mongoose');

const DeviceDataSchema = new mongoose.Schema({
    humidity: Number,
    mode: Number,      // 1: Auto, 2: Manual
    pumpState: Number, // 1: On, 0: Off
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('DeviceData', DeviceDataSchema);
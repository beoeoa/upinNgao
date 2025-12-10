// File: server/models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // Trong thực tế nên mã hóa, nhưng để demo ta lưu text thường
    role: { type: String, default: 'user' },    // 'admin' hoặc 'user'
    name: String
});

module.exports = mongoose.model('User', UserSchema);
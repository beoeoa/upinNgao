// File: server/server.js (PHIÊN BẢN FINAL - DEPLOY)
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const mqtt = require('mqtt');
const path = require('path');

// Import Models
const DeviceData = require('./models/DeviceData');
const User = require('./models/User');

const app = express();
app.use(bodyParser.json());
app.use(cors());

// --- 1. KẾT NỐI MONGODB ATLAS ---
const cloudURI = "mongodb+srv://beoeoa_db_user:beoeoa12345@cluster0.4zc3fiy.mongodb.net/tuoicay_smart?appName=Cluster0";

mongoose.connect(cloudURI)
    .then(async () => {
        console.log("✅ Đã kết nối MongoDB Atlas!");
        await initUsers();
    })
    .catch((err) => console.log("❌ Lỗi kết nối MongoDB:", err));

async function initUsers() {
    if (await User.countDocuments() === 0) {
        await new User({ username: 'admin', password: 'admin', role: 'admin', name: 'Quản trị viên' }).save();
        await new User({ username: 'user', password: '1234', role: 'user', name: 'Khách' }).save();
    }
}

// --- 2. CẤU HÌNH HIVEMQ MQTT ---
const mqttOptions = {
    host: '8c5ed51b21734939899ec1a1d0b1b7ae.s1.eu.hivemq.cloud', 
    port: 8883,
    protocol: 'mqtts', 
    username: 'upinngao',
    password: '123456aA'
};

const client = mqtt.connect(mqttOptions);

client.on('connect', () => {
    console.log("✅ Đã kết nối HiveMQ MQTT!");
    client.subscribe('tuoicay/data');
});

// --- BIẾN ĐỂ LỌC DỮ LIỆU ---
let lastSaveTime = 0;       
let lastPumpState = -1;    
let ramData = null;         

// --- 3. XỬ LÝ DỮ LIỆU TỪ ESP ---
client.on('message', async (topic, message) => {
    if (topic === 'tuoicay/data') {
        try {
            const dataStr = message.toString();
            const data = JSON.parse(dataStr);
            
            ramData = { ...data, timestamp: new Date() };

            const now = Date.now();
            const isPumpChanged = (data.pumpState !== lastPumpState);
            const isTimeUp = (now - lastSaveTime > 300000); 

            if (isPumpChanged || isTimeUp) {
                console.log(`💾 Đang lưu DB - Data: ${dataStr}`);
                const newData = new DeviceData({ 
                    humidity: data.humidity, 
                    mode: data.mode, 
                    pumpState: data.pumpState 
                });
                await newData.save();
                lastSaveTime = now;
                lastPumpState = data.pumpState;
            } else {
                process.stdout.write("."); 
            }
        } catch (e) { console.log("Lỗi MQTT:", e); }
    }
});

// --- 4. CẤU HÌNH HIỂN THỊ WEB ---
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- 5. CÁC API ---

// API lấy dữ liệu hiện tại
app.get('/api/web/current', async (req, res) => {
    if (ramData) res.json(ramData); 
    else {
        const latest = await DeviceData.findOne().sort({ timestamp: -1 });
        res.json(latest || { humidity: 0, mode: 0, pumpState: 0 });
    }
});

// API Gửi lệnh điều khiển (ĐÃ THÊM LẠI - QUAN TRỌNG)
app.post('/api/web/command', (req, res) => {
    const { cmd } = req.body;
    console.log("📤 Web gửi lệnh:", cmd);
    client.publish('tuoicay/cmd', cmd);
    res.json({ status: "Sent via MQTT" });
});

// API Đăng nhập (Đã thêm log debug)
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log("Login request:", username);
        const user = await User.findOne({ username });
        if (user && user.password === password) {
            res.json({ success: true, role: user.role, name: user.name });
        } else {
            res.json({ success: false, message: "Sai thông tin!" });
        }
    } catch (e) {
        console.log("Lỗi Login:", e);
        res.status(500).json({ success: false, message: "Lỗi Server" });
    }
});

// API Báo cáo (CHỈ GIỮ LẠI BẢN FIX MÚI GIỜ VN)
app.get('/api/report/stats', async (req, res) => {
    try {
        let dateStr = req.query.date;
        
        // Nếu không gửi ngày lên, mặc định lấy ngày hiện tại ở VN
        if (!dateStr) {
            const now = new Date();
            const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
            dateStr = vnTime.toISOString().split('T')[0];
        }

        // ÉP MÚI GIỜ +07:00
        const startDate = new Date(`${dateStr}T00:00:00+07:00`);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);

        console.log(`Report từ: ${startDate.toISOString()} đến ${endDate.toISOString()}`);

        const pumpCount = await DeviceData.countDocuments({ 
            timestamp: { $gte: startDate, $lt: endDate }, 
            pumpState: 1 
        });

        const avgHumData = await DeviceData.aggregate([
            { $match: { timestamp: { $gte: startDate, $lt: endDate } } },
            { $group: { _id: null, avgHum: { $avg: "$humidity" } } }
        ]);
        const avgHum = avgHumData.length > 0 ? Math.round(avgHumData[0].avgHum) : 0;
        
        const chartData = await DeviceData.find({ 
            timestamp: { $gte: startDate, $lt: endDate } 
        }).sort({ timestamp: 1 });

        res.json({ 
            date: dateStr, 
            pumpCount, 
            avgHumidity: avgHum, 
            chartData 
        });
    } catch (e) { 
        console.log(e);
        res.status(500).json({ error: "Lỗi báo cáo" }); 
    }
});

// --- 6. CHẠY SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server đang chạy tại port ${PORT}`));

// File: server/server.js (PHIÊN BẢN DEPLOY CLOUD)
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const mqtt = require('mqtt');
const path = require('path'); // <--- Thêm thư viện xử lý đường dẫn

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

// --- 4. CẤU HÌNH ĐỂ SERVER HIỂN THỊ WEB (QUAN TRỌNG KHI DEPLOY) ---

// Khai báo thư mục 'public' là nơi chứa file giao diện (html, css, js)
app.use(express.static(path.join(__dirname, 'public')));

// Khi khách vào trang chủ, gửi file index.html về
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- 5. API ---
app.get('/api/web/current', async (req, res) => {
    if (ramData) res.json(ramData); 
    else {
        const latest = await DeviceData.findOne().sort({ timestamp: -1 });
        res.json(latest || { humidity: 0, mode: 0, pumpState: 0 });
    }
});

// API Báo cáo (ĐÃ FIX LỖI MÚI GIỜ VIỆT NAM UTC+7)
app.get('/api/report/stats', async (req, res) => {
    try {
        let dateStr = req.query.date;
        
        // Nếu không gửi ngày lên, mặc định lấy ngày hiện tại ở VN
        if (!dateStr) {
            const now = new Date();
            // Hack nhẹ để lấy ngày giờ VN: cộng 7 tiếng
            const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
            dateStr = vnTime.toISOString().split('T')[0];
        }

        // --- KHÚC QUAN TRỌNG: ÉP MÚI GIỜ +07:00 ---
        // Bắt đầu: 00:00:00 ngày hôm đó tại VN
        const startDate = new Date(`${dateStr}T00:00:00+07:00`);
        
        // Kết thúc: 00:00:00 ngày hôm sau tại VN
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);

        console.log(`Xem báo cáo từ: ${startDate.toISOString()} đến ${endDate.toISOString()}`);

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
            date: dateStr, // Trả về đúng ngày người dùng chọn
            pumpCount, 
            avgHumidity: avgHum, 
            chartData 
        });
    } catch (e) { 
        console.log(e);
        res.status(500).json({ error: "Lỗi báo cáo" }); 
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (user && user.password === password) res.json({ success: true, role: user.role, name: user.name });
    else res.json({ success: false, message: "Sai thông tin!" });
});

app.get('/api/report/stats', async (req, res) => {
    try {
        const dateStr = req.query.date; 
        let startDate = dateStr ? new Date(dateStr) : new Date();
        startDate.setHours(0,0,0,0);
        let endDate = new Date(startDate); endDate.setDate(endDate.getDate() + 1);

        const pumpCount = await DeviceData.countDocuments({ timestamp: { $gte: startDate, $lt: endDate }, pumpState: 1 });
        const avgHumData = await DeviceData.aggregate([{ $match: { timestamp: { $gte: startDate, $lt: endDate } } }, { $group: { _id: null, avgHum: { $avg: "$humidity" } } }]);
        const avgHum = avgHumData.length > 0 ? Math.round(avgHumData[0].avgHum) : 0;
        const chartData = await DeviceData.find({ timestamp: { $gte: startDate, $lt: endDate } }).sort({ timestamp: 1 });

        res.json({ date: startDate.toLocaleDateString('vi-VN'), pumpCount, avgHumidity: avgHum, chartData });
    } catch (e) { res.status(500).json({ error: "Lỗi báo cáo" }); }
});

// --- 6. CHẠY SERVER (SỬA PORT CHO CLOUD) ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`Server đang chạy tại port ${PORT}`));

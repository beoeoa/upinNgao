// File: server/server.js (PHIÊN BẢN SMART - TỰ HỌC)
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
        // Khi khởi động Server, chạy phân tích 1 lần để lấy cấu hình
        await analyzeHistory();
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

// --- BIẾN HỆ THỐNG ---
let lastSaveTime = 0;       
let lastPumpState = -1;    
let ramData = null;         

// === [MỚI] CẤU HÌNH THÔNG MINH ===
// Mặc định ngưỡng là 600. (Lưu ý: Cảm biến điện dung thường là Cao=Khô, Thấp=Ướt)
// Quy tắc: Nếu độ ẩm > threshold => Đất khô => Bật bơm
let smartConfig = {
    threshold: 600,           // Ngưỡng kích hoạt tưới (Mặc định)
    status: "Chưa phân tích", // Trạng thái AI
    lastRun: null             // Thời gian phân tích cuối
};

// === [MỚI] HÀM PHÂN TÍCH DỮ LIỆU QUÁ KHỨ ===
// === HÀM PHÂN TÍCH DỮ LIỆU LỚN (Thay thế hàm cũ trong server.js) ===
async function analyzeHistory() {
    console.log("🧠 [AI] Đang phân tích xu hướng 7 ngày qua...");
    
    // Mốc thời gian: 7 ngày trước
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    // Tính trung bình độ ẩm của 7 ngày qua (Trend Analysis)
    const stats = await DeviceData.aggregate([
        { $match: { timestamp: { $gte: sevenDaysAgo } } },
        { 
            $group: { 
                _id: null, 
                avgHum: { $avg: "$humidity" },
                totalPump: { $sum: "$pumpState" } // Đếm tổng số lần bơm
            } 
        }
    ]);

    if (stats.length > 0) {
        const avgHum = Math.round(stats[0].avgHum);
        const pumpCount = stats[0].totalPump;

        console.log(`📊 [AI REPORT] 7 Ngày qua: Ẩm TB=${avgHum}, Bơm=${pumpCount} lần`);

        // --- LOGIC QUYẾT ĐỊNH DỰA TRÊN DỮ LIỆU TUẦN ---
        
        // 1. Nếu trung bình tuần < 450 (Đợt nắng nóng kéo dài)
        if (avgHum < 450) {
            smartConfig.threshold = 700; 
            smartConfig.status = `🔥 Đợt nắng nóng kéo dài (TB tuần:${avgHum}) -> Tăng ngưỡng lên 700`;
        } 
        // 2. Nếu trung bình tuần > 750 (Mùa mưa/Nồm)
        else if (avgHum > 750) {
            smartConfig.threshold = 900; // Hầu như không cần tưới
            smartConfig.status = `🌧️ Mùa mưa ẩm (TB tuần:${avgHum}) -> Giảm tưới tối đa`;
        } 
        // 3. Bình thường
        else {
            smartConfig.threshold = 600;
            smartConfig.status = `✅ Thời tiết ổn định (TB tuần:${avgHum})`;
        }
        smartConfig.lastRun = new Date();
    } else {
        console.log("⚠️ [AI] Chưa đủ dữ liệu 7 ngày để phân tích.");
        smartConfig.status = "Đang thu thập dữ liệu...";
    }
}

// --- 3. XỬ LÝ DỮ LIỆU TỪ ESP ---
client.on('message', async (topic, message) => {
    if (topic === 'tuoicay/data') {
        try {
            const dataStr = message.toString();
            const data = JSON.parse(dataStr);
            
            // Cập nhật RAM
            ramData = { ...data, timestamp: new Date() };

            // === [MỚI] LOGIC ĐIỀU KHIỂN TỰ ĐỘNG THÔNG MINH ===
            // Server giành quyền điều khiển khi ở chế độ AUTO
            if (data.mode === 1) { 
                // Điều kiện: Đất Khô (> Ngưỡng) VÀ Bơm đang tắt
                if (data.humidity > smartConfig.threshold && data.pumpState === 0) {
                    console.log(`🤖 [AUTO] Đất khô (${data.humidity} > ${smartConfig.threshold}) -> GỬI LỆNH BẬT BƠM`);
                    client.publish('tuoicay/cmd', 'CMD:PUMP_ON');
                }
                // Điều kiện: Đất Đủ ẩm (< Ngưỡng) VÀ Bơm đang bật
                else if (data.humidity <= smartConfig.threshold && data.pumpState === 1) {
                    console.log(`🤖 [AUTO] Đủ ẩm (${data.humidity} <= ${smartConfig.threshold}) -> GỬI LỆNH TẮT BƠM`);
                    client.publish('tuoicay/cmd', 'CMD:PUMP_OFF');
                }
            }
            // ================================================

            const now = Date.now();
            const isPumpChanged = (data.pumpState !== lastPumpState);
            const isTimeUp = (now - lastSaveTime > 300000); // 5 phút

            if (isPumpChanged || isTimeUp) {
                console.log(`💾 Đang lưu DB - Hum:${data.humidity} Mode:${data.mode} Pump:${data.pumpState}`);
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

app.get('/api/web/current', async (req, res) => {
    if (ramData) res.json(ramData); 
    else {
        const latest = await DeviceData.findOne().sort({ timestamp: -1 });
        res.json(latest || { humidity: 0, mode: 0, pumpState: 0 });
    }
});

app.post('/api/web/command', (req, res) => {
    const { cmd } = req.body;
    console.log("📤 Web gửi lệnh:", cmd);
    client.publish('tuoicay/cmd', cmd);
    res.json({ status: "Sent via MQTT" });
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (user && user.password === password) {
            res.json({ success: true, role: user.role, name: user.name });
        } else {
            res.json({ success: false, message: "Sai thông tin!" });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: "Lỗi Server" });
    }
});

// === [MỚI] API TEST THÔNG MINH (DÙNG ĐỂ DEMO) ===
// Gọi link này để ép hệ thống phân tích lại ngay lập tức
app.get('/api/test-smart', async (req, res) => {
    await analyzeHistory(); // Chạy phân tích
    res.json({
        message: "Đã chạy phân tích dữ liệu quá khứ!",
        config: smartConfig // Trả về cấu hình mới để xem
    });
});

app.get('/api/report/stats', async (req, res) => {
    try {
        let dateStr = req.query.date;
        if (!dateStr) {
            const now = new Date();
            const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
            dateStr = vnTime.toISOString().split('T')[0];
        }

        const startDate = new Date(`${dateStr}T00:00:00+07:00`);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);

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
        res.status(500).json({ error: "Lỗi báo cáo" }); 
    }
});

// --- 6. CHẠY SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server Smart đang chạy tại port ${PORT}`));

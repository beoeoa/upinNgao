// File: seed.js (Dữ liệu 1 năm - 365 ngày)
const mongoose = require('mongoose');

// Định nghĩa Model
const DeviceDataSchema = new mongoose.Schema({
    humidity: Number,
    mode: Number,
    pumpState: Number,
    timestamp: Date
});
const DeviceData = mongoose.model('DeviceData', DeviceDataSchema);

// URI MongoDB của bạn
const cloudURI = "mongodb+srv://beoeoa_db_user:beoeoa12345@cluster0.4zc3fiy.mongodb.net/tuoicay_smart?appName=Cluster0";

mongoose.connect(cloudURI)
    .then(async () => {
        console.log("✅ Đã kết nối DB. Đang tạo dữ liệu 1 NĂM (Vui lòng chờ khoảng 10-20 giây)...");
        await seedData();
    })
    .catch(err => console.log(err));

async function seedData() {
    // Xóa dữ liệu cũ để tránh trùng lặp
    await DeviceData.deleteMany({});
    console.log("🗑️ Đã xóa dữ liệu cũ.");

    const records = [];
    const now = new Date();

    // Vòng lặp 365 ngày
    for (let d = 365; d >= 0; d--) {
        // Mỗi ngày tạo 12 điểm dữ liệu (2 tiếng 1 lần cho nhẹ DB)
        for (let h = 0; h < 24; h += 2) {
            const fakeTime = new Date(now);
            fakeTime.setDate(fakeTime.getDate() - d);
            fakeTime.setHours(h, 0, 0, 0);

            const month = fakeTime.getMonth() + 1; // Tháng 1-12
            let hum = 0;
            let pump = 0;

            // LOGIC MÙA VỤ:
            // Mùa Hè (Tháng 5,6,7,8): Khô hạn
            if (month >= 5 && month <= 8) {
                // Ban ngày (10h-16h) rất khô
                if (h >= 10 && h <= 16) {
                    hum = Math.floor(Math.random() * 200 + 200); // 200-400 (Rất khô)
                    pump = 1; // Phải bơm
                } else {
                    hum = Math.floor(Math.random() * 200 + 400); // 400-600
                }
            } 
            // Các mùa khác: Ẩm ướt
            else {
                hum = Math.floor(Math.random() * 300 + 600); // 600-900 (Ẩm)
                pump = 0; // Ít bơm
            }

            // Có xác suất nhỏ mưa bất chợt vào mùa hè
            if (month === 7 && Math.random() > 0.9) hum = 950;

            records.push({
                humidity: hum,
                mode: 1, // Auto
                pumpState: pump,
                timestamp: fakeTime
            });
        }
    }

    // Chia nhỏ ra để insert cho đỡ lỗi (Batch insert)
    const chunkSize = 500;
    for (let i = 0; i < records.length; i += chunkSize) {
        await DeviceData.insertMany(records.slice(i, i + chunkSize));
        process.stdout.write("."); // Hiện dấu chấm để biết đang chạy
    }

    console.log(`\n🎉 XONG! Đã thêm ${records.length} bản ghi của 1 năm qua.`);
    process.exit();
}

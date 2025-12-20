const mongoose = require('mongoose');
// Copy mô hình dữ liệu để không phải import rắc rối
const DeviceDataSchema = new mongoose.Schema({
    humidity: Number,
    mode: Number,
    pumpState: Number,
    timestamp: Date
});
const DeviceData = mongoose.model('DeviceData', DeviceDataSchema);

// COPY URI TỪ SERVER.JS CỦA BẠN SANG ĐÂY
const cloudURI = "mongodb+srv://beoeoa_db_user:beoeoa12345@cluster0.4zc3fiy.mongodb.net/tuoicay_smart?appName=Cluster0";

mongoose.connect(cloudURI)
    .then(async () => {
        console.log("✅ Đã kết nối DB. Đang tạo dữ liệu giả...");
        await seedData();
    })
    .catch(err => console.log(err));

async function seedData() {
    // Xóa dữ liệu cũ (Cẩn thận khi dùng thật)
    // await DeviceData.deleteMany({});
    
    const records = [];
    const now = new Date();

    // Giả lập 3 ngày qua
    for (let d = 3; d >= 1; d--) {
        for (let h = 0; h < 24; h++) {
            const fakeTime = new Date(now);
            fakeTime.setDate(fakeTime.getDate() - d);
            fakeTime.setHours(h, 0, 0, 0);

            // LOGIC GIẢ LẬP:
            // 10h-15h: Nắng nóng -> Độ ẩm thấp (300-400) -> Để hệ thống thấy là CẦN TƯỚI NHIỀU
            let hum = (h >= 10 && h <= 15) ? Math.floor(Math.random() * 100 + 300) : 800;
            
            records.push({
                humidity: hum,
                mode: 1, // Auto
                pumpState: (hum < 500) ? 1 : 0, // Khô thì bơm bật
                timestamp: fakeTime
            });
        }
    }

    await DeviceData.insertMany(records);
    console.log(`🎉 Đã thêm ${records.length} dòng dữ liệu mẫu!`);
    process.exit();
}
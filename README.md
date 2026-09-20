# HR-Chamcong

## Giờ Công

Ứng dụng chấm công MVP chạy bằng HTML/CSS/JavaScript thuần, Supabase Auth + PostgreSQL/RLS và có thể deploy trực tiếp lên Vercel.

### Chạy local

Mở `indec.html` trực tiếp hoặc chạy `python3 -m http.server 4173`, sau đó mở `http://localhost:4173`. Khi chưa cấu hình Supabase, chọn **Xem bản demo** để kiểm tra giao diện.

### Kết nối Supabase

1. Tạo project tại Supabase, mở **SQL Editor** và chạy toàn bộ file `supabase-schema.sql`.
2. Vào **Project Settings → API**, sao chép Project URL và anon key vào `config.js`.
3. Tạo tài khoản tại **Authentication → Users**. Trigger sẽ tự tạo hồ sơ nhân viên.
4. Chạy câu lệnh cuối trong `supabase-schema.sql` để chuyển tài khoản đầu tiên thành `admin`.
5. Kiểm tra Auth URL Configuration, thêm domain Vercel vào **Site URL** và **Redirect URLs**.

### Deploy GitHub + Vercel

Tạo repository GitHub, đẩy các file trong thư mục này lên, sau đó vào Vercel chọn **New Project → Import Git Repository**. Vì đây là site tĩnh, giữ nguyên build command trống và deploy. Cập nhật `config.js` trước khi push hoặc dùng biến môi trường qua quy trình build riêng.

Quyền admin không được quyết định bởi giao diện: bảng `profiles.role` và các policy RLS trong Supabase là lớp bảo vệ thực tế. Nhân viên chỉ đọc/ghi bản ghi chấm công của chính mình; admin đọc được toàn bộ dữ liệu.

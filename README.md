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

### Tạo 12 tài khoản mẫu

Không đặt service role key trong HTML, `config.js` hoặc GitHub. Sau khi rotate key, tạo file `.env.local` từ `.env.local.example`, điền `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY`, rồi chạy:

```bash
node provision-users.mjs
```

Script tạo `own@gmail.com` với role `own`, `admin@gmail.com` với role `admin`, và `test1@gmail.com` đến `test10@gmail.com` với role `employee`. Mật khẩu khởi tạo là `123456`; người dùng có thể đổi mật khẩu bất cứ lúc nào từ nút **Đổi mật khẩu** sau khi đăng nhập. Mật khẩu được ghi vào `created-users.csv`, file này đã nằm trong `.gitignore`.

Sau khi deploy, cần deploy thêm hai Edge Function:

```bash
supabase functions deploy create-employee
supabase functions deploy change-password
```

Không dùng `123456` cho tài khoản nào khác và không gửi file `created-users.csv` lên GitHub. Việc đổi mật khẩu là tùy chọn, không bắt buộc ngay sau đăng nhập.
Mật khẩu mới được lưu trong Supabase Auth bởi function `change-password`; nếu chưa deploy function, màn hình sẽ báo rõ và không giả lập việc đổi mật khẩu thành công.

### Audit đăng nhập và bảo mật

Chạy `audit-logs.sql` trong Supabase SQL Editor sau schema nền. Hệ thống ghi `login`, `logout` và `password_change` vào `audit_logs`. Chỉ tài khoản `admin` hoặc `own` được đọc nhật ký; nhân viên không thể đọc, sửa hoặc xóa log. Sau khi chạy SQL, deploy lại function:

```bash
supabase functions deploy change-password
```

Admin/own xem nhật ký tại bảng **Giám sát hoạt động** trong dashboard.

### Whitelist IP cho chấm công

1. Sau schema ban đầu, chạy `whitelist-ip.sql` trong Supabase SQL Editor. Với dự án đã có bảng, chỉ chạy file mới này.
2. Đăng nhập tài khoản admin, tìm **Whitelist IP**. Thêm IP công cộng của văn phòng (xem **IP hiện tại** khi kết nối mạng văn phòng), hoặc dải CIDR IPv4/IPv6. Không dùng IP LAN như `192.168.x.x`.
3. Danh sách trống chặn mọi thao tác vào/ra ca, bao gồm admin. Admin vẫn có thể quản lý danh sách từ mạng khác. Đọc lịch sử và đăng nhập không bị giới hạn IP. Demo không lưu dữ liệu và không kiểm tra IP.
4. Kiểm tra bằng tài khoản nhân viên: mạng được phép lưu được; mạng ngoài danh sách bị từ chối và giao diện không báo lưu thành công. Thử cả vào ca và ra ca.

IP lấy từ header `cf-connecting-ip` do lớp Cloudflare của Supabase hosted cung cấp; không lấy IP do JavaScript gửi lên hoặc phần tử đầu của `X-Forwarded-For`. Thiếu/sai IP sẽ bị chặn. Cấu hình này dành cho kết nối trực tiếp tới Supabase hosted; nếu tự host hoặc đổi proxy, cần xác minh proxy ghi đè header này từ địa chỉ kết nối đáng tin cậy trước khi sử dụng. Khi triển khai cần kiểm thử request giả mạo header từ mạng ngoài whitelist bị từ chối. Xem [Cloudflare headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/) và [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api).

RLS kiểm tra IP khi INSERT/UPDATE vào bảng attendance, kể cả gọi REST API trực tiếp. Không đưa service-role key vào trình duyệt vì khóa đó bỏ qua RLS. IP động của văn phòng cần được admin cập nhật khi nhà mạng thay đổi.

### Tạo tài khoản nhân viên và giới hạn quyền

1. Chạy `employee-permissions.sql` trong SQL Editor sau schema ban đầu. File này giữ nguyên các policy Whitelist IP; nhân viên chỉ đọc hồ sơ của mình, đọc chấm công của mình, bắt đầu ca và kết thúc ca một lần. Giờ chấm công lấy từ máy chủ. Nhân viên không được sửa/xóa lịch sử, đổi vai trò hoặc quản lý nhân viên khác.
2. Deploy Edge Function `create-employee` từ thư mục `supabase/functions/create-employee`:
   ```sh
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy create-employee
   ```
   `supabase/config.toml` tắt kiểm tra JWT kiểu cũ tại gateway; hàm tự xác thực token bằng `auth.getUser()` và kiểm tra `profiles.role = admin` trước khi tạo tài khoản. `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` là biến môi trường phía Edge Function; tuyệt đối không chép service key vào `config.js`.
3. Đăng nhập admin → **Quản trị nhân sự** → nhập họ tên, email và mật khẩu → **Tạo nhân viên**. Hàm tạo tài khoản đã xác nhận email, không gửi email; admin cung cấp thông tin đăng nhập cho nhân viên. Vai trò luôn là `employee`, không lấy từ dữ liệu trình duyệt.
4. Nếu chưa deploy hàm, có thể tạo tài khoản tại Supabase **Authentication → Users → Add user**. Trigger tự tạo hồ sơ `employee`. Không cập nhật role thành admin cho nhân viên.
5. Nếu chỉ cho phép admin tạo người dùng, tắt đăng ký công khai trong cấu hình Supabase Auth. Không cần mở đăng ký công khai để dùng hàm quản trị.

Kiểm thử sau triển khai: tạo hai nhân viên A/B, chấm công ở IP được phép; A chỉ thấy lịch sử A (20 dòng/trang), không đọc/ghi được bản ghi B qua REST, không sửa ca đã kết thúc, không đổi `profiles.role`, không gọi được `create-employee` (403). Admin tạo tài khoản thành công; email trùng báo lỗi. Mạng ngoài whitelist vẫn bị chặn vào/ra ca. Đăng xuất admin rồi đăng nhập nhân viên phải ẩn quản trị và xuất báo cáo.

API tạo người dùng chỉ chạy phía máy chủ theo [Supabase admin.createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser).

### Quản trị công và báo cáo

- Chạy thêm `admin-attendance.sql` sau `whitelist-ip.sql` và `employee-permissions.sql`. Không chạy lại schema ban đầu trên cơ sở dữ liệu đã có bảng.
- Admin vào **Quản trị nhân sự** để xem danh sách nhân viên thật (tên, phòng ban, mã UUID). Tạo tài khoản bằng form hiện có; danh sách tự làm mới khi tạo thành công.
- **Lịch sử chấm công nhân viên**: chọn nhân viên hoặc tất cả, khoảng ngày rồi xem. Giao diện chia 20 dòng/trang. **Xuất CSV** hoặc **Xuất báo cáo** xuất toàn bộ dữ liệu theo bộ lọc, không chỉ trang hiện tại; CSV có BOM UTF-8 và xử lý nội dung có thể bị ứng dụng bảng tính đọc thành công thức. Báo cáo chỉ gồm tài khoản có vai trò employee; số giờ là thời gian vào/ra, chưa trừ nghỉ hoặc quy đổi ngày công.
- **Bổ sung / điều chỉnh công**: chọn nhân viên, ngày → **Tải công ngày này** → nhập giờ Việt Nam và lý do → lưu. Có thể thêm công thiếu hoặc điều chỉnh bản ghi đã có. Giờ ra có thể sang ngày hôm sau; không chấp nhận giờ trong tương lai. Nếu dữ liệu thay đổi sau lúc tải, lưu bị từ chối để tránh ghi đè ca nhân viên vừa chấm.
- RPC `admin_save_attendance` kiểm tra vai trò admin và Whitelist IP phía máy chủ. Chỉ admin có IP được phép mới bổ sung công được; nhân viên không gọi được RPC này. Mỗi lần lưu qua RPC ghi người sửa, lý do, dữ liệu trước/sau vào `attendance_adjustments`; chỉ admin được đọc nhật ký.
- Kiểm thử triển khai: admin tạo nhân viên, tải danh sách, thêm công ngày cũ, sửa giờ ra, xuất báo cáo theo nhân viên/khoảng ngày; thử báo cáo hơn 1.000 bản ghi. Thử chỉnh sửa đồng thời với nhân viên chấm ra để xác nhận báo xung đột. Nhân viên gọi RPC bổ sung công phải bị từ chối; đăng xuất admin rồi đăng nhập nhân viên không hiển thị dữ liệu quản trị.

### Own duyệt yêu cầu của admin (cấu hình mới nhất)

**Chạy theo thứ tự:** `supabase-schema.sql` (chỉ dự án mới) → `whitelist-ip.sql` → `employee-permissions.sql` → `admin-attendance.sql` → **`owner-role.sql`** → **`owner-approvals.sql`**. Chạy `owner-role.sql` riêng và hoàn tất trước khi chạy file tiếp theo để PostgreSQL ghi nhận enum mới. Hai file owner có thể chạy lại; không chạy lại các migration cũ sau file owner vì chúng có thể khôi phục quyền cũ.

1. Dùng tài khoản đã có trong Authentication để làm own. Trong SQL Editor, thay UUID thật rồi chạy:
   ```sql
   update public.profiles set role = 'own', is_active = true where id = 'UUID_TAI_KHOAN_OWN';
   ```
   Không có mật khẩu own mặc định. Chỉ SQL Editor có thể khởi tạo own; giao diện không cho admin tự cấp quyền own hoặc sửa/khóa own.
2. **Deploy lại** Edge Function `create-employee` để bật kiểm tra quyền mới. Không dùng phiên bản cũ của hàm với luồng phê duyệt mới. Admin mặc định chưa có quyền tạo nhân viên; chọn tài khoản admin trong mục **Thông tin và quyền tài khoản** → nhập lý do → yêu cầu cấp quyền. Own duyệt quyền này thì admin mới tạo được nhân viên; own có thể tạo trực tiếp. Đây là quyền tạo tài khoản được cấp trước, không phải duyệt từng tài khoản mới.
3. Admin gửi yêu cầu sửa/bổ sung công, xóa công, thêm/xóa IP hoặc thay đổi tên/phòng ban/vai trò/trạng thái tài khoản. Yêu cầu được lưu, dữ liệu gốc chưa đổi. Sửa công tự chấm của chính admin qua API cũng bị giới hạn như nhân viên: chỉ vào/ra ca một lần, không sửa lịch sử.
4. Own đăng nhập, vào mục **Own · Duyệt yêu cầu** bên dưới trang để xem người gửi, lý do và dữ liệu trước/sau; bấm **Đồng ý và thực hiện** hoặc **Từ chối**. Chấp thuận và cập nhật dữ liệu nằm trong cùng giao dịch. Không cần admin gửi lại lệnh. Giao diện kiểm tra trạng thái mỗi 15 giây khi tab đang hiển thị; có nút Làm mới.
5. Yêu cầu có trạng thái `pending` (chờ), `applied` (đã duyệt và cập nhật thành công), `rejected` (từ chối), `failed` (không cập nhật được). Bấm duyệt hai lần không thực hiện hai lần. Dữ liệu đã thay đổi, IP không hợp lệ hoặc người gửi mất quyền sẽ làm yêu cầu thất bại và không ghi đè. Cần gửi yêu cầu mới sau khi xử lý nguyên nhân.
6. Quy định IP giữ nguyên: người gửi yêu cầu công và own duyệt công cần IP trong whitelist. Duyệt thay đổi whitelist không cần IP được phép, để own có thể thêm IP đầu tiên. Khóa tài khoản là vô hiệu hóa quyền truy cập dữ liệu qua RLS và chặn tạo nhân viên qua Edge Function, không xóa người dùng Auth hoặc lịch sử. Xóa công giữ lại snapshot trong yêu cầu và nhật ký điều chỉnh cũ.

Cơ chế bảo vệ: RLS chặn ghi trực tiếp các bảng quản trị; RPC sửa công cũ bị thu hồi quyền gọi; bảng yêu cầu không cho trình duyệt tự INSERT/UPDATE/DELETE; RPC kiểm tra vai trò đang có trong `profiles`, không tin role do trình duyệt gửi. Service-role key/SQL Editor vẫn là quyền vận hành tin cậy, không phân phối cho admin ứng dụng.

Kiểm thử tích hợp: chạy `tests/owner-approvals.sql` trên **project thử nghiệm** sau các migration. Script tạo dữ liệu tạm, kiểm tra chặn API trực tiếp, tự nâng quyền, admin tự duyệt, duyệt lặp, từ chối, xung đột dữ liệu, cấp quyền và giới hạn nhân viên; cuối cùng rollback. Cần kiểm tra thêm Edge Function: admin chưa được cấp quyền trả 403; sau own duyệt thì tạo được; khi thu hồi quyền/khóa admin thì trả 403.

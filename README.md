# Roamly — Trip Map MVP

Ứng dụng web lập kế hoạch chuyến đi, ưu tiên trải nghiệm mobile và có thể triển khai trực tiếp lên GitHub Pages.

## Tính năng MVP

- Chọn hoặc tìm điểm đến tại Việt Nam.
- Tạo chuyến đi với tên, ngày đi, phong cách và ghi chú.
- Thêm khách sạn, điểm tham quan, quán ăn từ dữ liệu gợi ý hoặc tìm kiếm Google Geocoding/OpenStreetMap.
- Nhập và tải xuống lịch trình JSON theo cùng một cấu trúc chuẩn.
- Dùng một khách sạn duy nhất làm điểm xuất phát trung tâm.
- Bản đồ là giao diện chính, hiển thị tên và ETA xe máy ngay trên từng marker; khách sạn có biểu tượng nổi bật, mỗi nhóm địa điểm có biểu tượng riêng.
- Phóng to, thu nhỏ bản đồ tới mức zoom 21 bằng nút trên bản đồ; mức zoom thủ công được giữ khi tuyến đường cập nhật.
- Xem lịch trình JSON theo từng ngày; ngày được chia thành điểm chính và điểm có thể ghé.
- Tính độc lập thời gian từ vị trí hiện tại tới từng địa điểm chưa đi, rồi lọc điểm và tuyến theo ngày đang xem.
- Đánh dấu điểm đã đi; tuyến tiếp theo được tính từ điểm đánh dấu gần nhất tới các điểm chưa đi. Bỏ dấu sẽ quay về điểm đã đi trước đó hoặc khách sạn.
- Chạm một địa điểm để ẩn các tuyến còn lại, tập trung đúng tuyến và mở dẫn đường Google Maps.
- Chạm một điểm bất kỳ trên nền bản đồ để xem địa chỉ, sửa tên hoặc loại điểm, rồi thêm vào ngày đang xem. App ưu tiên tên Google Places, sau đó thử tìm điểm có tên cách vị trí chạm tối đa 35 m trên OpenStreetMap/Photon. Gợi ý OpenStreetMap cần kiểm tra lại trước khi thêm. Mã Plus Code không được dùng làm tên; nếu cả hai nguồn không trả tên, ô tên để trống để nhập thủ công. Điểm đã lưu có nút **Sửa tên** trên thẻ bản đồ.
- Tải sẵn tuyến đường bộ từ vị trí hiện tại tới từng điểm chưa đi theo các nhóm request nhỏ; có ước lượng dự phòng khi dịch vụ bận.
- Lưu nhiều chuyến đi bằng `localStorage`; trang chủ hiển thị danh sách để mở lại từng chuyến.
- Chia sẻ chuyến đi qua URL.
- Xuất các điểm đã chọn sang trang dẫn đường Google Maps.
- Responsive cho desktop và mobile.

## Công nghệ và API

| Nhu cầu | MVP đang dùng | Ghi chú |
|---|---|---|
| Hiển thị bản đồ | Google Maps JavaScript API + Advanced Markers | Key lấy từ runtime config; cần Maps JavaScript API và billing |
| Tìm địa điểm | Google Geocoding, dự phòng Nominatim + Photon / OpenStreetMap | Tìm khi bấm Tìm; ưu tiên ngữ cảnh điểm đến |
| Tính tuyến | OSRM public demo | Có fallback ước tính khi API bận |
| Lưu dữ liệu | `localStorage` | Không cần backend |
| Mở dẫn đường | Google Maps URL | Không gọi thêm API |

Các public API phù hợp MVP lưu lượng thấp, không có SLA. Khi đưa lên production nên dùng Geoapify, LocationIQ, HERE hoặc tự host Nominatim/OSRM.

OSRM public dùng profile đường bộ `driving`, không có profile xe máy Việt Nam riêng. MVP cộng hệ số 10% cho dừng/đỗ và giao thông đô thị, vì vậy mọi ETA xe máy đều được ghi rõ là **dự kiến**. Google Maps dùng cho nền bản đồ và marker; Google Geocoding tìm địa điểm. Phần tuyến vẫn dùng OSRM để không yêu cầu bật thêm Routes API.

Trong ngày đang xem, bản đồ vẽ các tuyến từ khách sạn hoặc điểm được tick gần nhất tới những điểm chưa đi. Khi người dùng chọn một điểm, các tuyến còn lại được ẩn để làm nổi bật đúng tuyến cần đi; bấm lại điểm đó hoặc bấm khách sạn để hiện lại các tuyến của ngày.

## Chạy local

Yêu cầu Node.js 18 trở lên. Không cần cài dependency.

```powershell
cd D:\Toys\trip-map
npm start
```

Mở <http://127.0.0.1:3000>.

Kiểm tra cú pháp:

```powershell
npm run check
```

## Cấu hình Google Maps

Khi chạy `npm start`, server lấy key từ biến môi trường `GOOGLE_MAPS_API_KEY` hoặc tệp `key.md` (ưu tiên biến môi trường), rồi phục vụ `/runtime-config.js` trong bộ nhớ. `key.md` nằm trong `.gitignore`; tệp `public/runtime-config.js` trong source chỉ là placeholder rỗng. Vì trình duyệt phải gửi key tới Google, key sẽ xuất hiện trong yêu cầu mạng của trang. Cần bật **Maps JavaScript API** và **Geocoding API**. Để lấy đúng tên địa điểm khi chạm nhãn trên bản đồ, cần bật thêm **Places API (New)** và cho phép API đó trong giới hạn của key; nếu không, app để trống tên để người dùng nhập thủ công.

Advanced Markers cần map ID. Bản chạy thử dùng `DEMO_MAP_ID`; khi triển khai chính thức, đặt `GOOGLE_MAPS_MAP_ID` thành map ID của dự án Google Cloud. Bản build GitHub Pages tạo `dist/runtime-config.js` từ biến môi trường, không dùng `key.md`.

Có thể mở `./google-maps-test.html` để kiểm tra riêng key trên cùng origin với ứng dụng.

## JSON chuyến đi

[`da-lat-json.json`](./da-lat-json.json) là file mẫu chuẩn `schema_version: "1.1.0"`. Trên trang chủ hoặc trong chuyến đi, bấm **Nhập JSON** và chọn file. Sau khi sửa trong app, bấm **Tải JSON** để lấy bản mới; app không thể ghi đè trực tiếp file trên máy.

Mỗi chuyến đi được lưu riêng trên thiết bị và xuất hiện trong mục **Chuyến đi của tôi** ở trang chủ. Nhập lại JSON có cùng `trip.id` sẽ cập nhật chuyến đã lưu; để giữ hai phiên bản độc lập, đặt `trip.id` khác nhau. Dữ liệu từ cách lưu một chuyến cũ được chuyển sang danh sách khi lưu chuyến tiếp theo.

Các trường chính:

| Trường | Ý nghĩa |
|---|---|
| `trip.id`, `trip.name`, `trip.destination` | Thông tin bắt buộc của chuyến đi |
| `trip.start_date`, `trip.end_date` | Ngày tùy chọn; bỏ qua hoặc đặt `null` nếu chưa biết, nếu có thì theo `YYYY-MM-DD` |
| `hub` | Khách sạn làm tâm tuyến đường; `type` phải là `hotel` |
| `places[]` | Danh mục địa điểm, mỗi `id` là duy nhất |
| `places[].category` | Phân loại chi tiết để giữ ngữ nghĩa của dữ liệu nguồn |
| `places[].map_category` | Nhóm icon trên app: `sight`, `food`, `other` |
| `selected_place_ids[]` | ID các điểm đang hiển thị trên bản đồ; khách sạn luôn được chọn |
| `visited_place_ids[]` | ID các điểm đã đi, theo thứ tự đánh dấu; phần tử cuối là điểm xuất phát hiện tại |
| `days[]` | Lịch theo ngày; `date` tùy chọn, còn `main_places` và `optional_places` tham chiếu ID từ `places` |
| `planner_rules` | Quy tắc lập lịch, được giữ nguyên khi nhập/xuất |
| `coordinates` | Tùy chọn, theo thứ tự `[kinh độ, vĩ độ]`; nếu thiếu, app tìm từ `map_query` rồi `name/address` |
| `place_id` | Tùy chọn; nếu có, app tra đúng điểm qua Google Geocoding trước khi vẽ bản đồ |

File được kiểm tra phiên bản, ngày, ID trùng hoặc không tồn tại, nhóm icon và tọa độ trước khi nhập. Nếu không xác định được vị trí của một điểm, app báo lỗi và giữ chuyến đi hiện tại. JSON tải xuống giữ `place_id` và bỏ tọa độ tra từ Google; tọa độ nhập sẵn không gắn `place_id` được giữ lại. Sau khi nhập, app mở ngày đầu tiên trong `days`; các tab chỉ ghi **Ngày 1**, **Ngày 2**, **Ngày 3**, còn ngày tháng và chủ đề nằm bên dưới. Điểm nằm trong `days` nhưng chưa được chọn vẫn hiện trong danh sách ngày để thêm lại, còn bản đồ chỉ vẽ các điểm đã chọn. Khi thêm địa điểm mới lúc đang xem một ngày, app đưa điểm đó vào `main_places` của ngày hiện tại để hiện ngay trên bản đồ; điểm đã chọn ở ngày khác có nút thêm vào ngày hiện tại. Tick **Đã đi** trong danh sách hoặc thẻ trên bản đồ; các điểm đã đi vẫn hiện dấu ✓ nhưng không có tuyến tới đó. `visited_place_ids` được lưu khi tải JSON và phải nằm trong `selected_place_ids`. `planner_rules` được giữ nguyên trong JSON để chỉnh tiếp về sau.

Trong Google Cloud Console, bật **Maps JavaScript API**, **Geocoding API** và **Places API (New)** nếu muốn lấy tên điểm trên bản đồ, rồi giới hạn key theo **Websites / HTTP referrers** cho `http://127.0.0.1:*`, `http://localhost:*` và domain triển khai thực tế. Đặt API restriction cho các API đang dùng.

## Triển khai GitHub Pages

Thư mục `trip-map` hiện nằm trong Git repository `D:\Toys`, chưa có remote GitHub. Workflow trong `.github/workflows/deploy-pages.yml` hoạt động khi **nội dung của `trip-map` là thư mục gốc của một repository GitHub riêng**, nhánh `main`. Nếu đẩy cả `D:\Toys` lên GitHub, GitHub sẽ không nhận workflow nằm trong `trip-map/.github/`.

1. Tạo repository GitHub riêng cho ứng dụng và đưa **các file trong `trip-map`** lên thư mục gốc của repository, gồm cả `.github/workflows/deploy-pages.yml`. Không đưa `key.md` hoặc `dist/` lên Git.
2. Trong Google Cloud Console, tạo hoặc dùng một browser key có application restriction **Websites** cho `https://<ten-tai-khoan>.github.io/*` (và custom domain nếu có). Giới hạn API cho **Maps JavaScript API**, **Geocoding API**, **Places API (New)**; bật billing. Nên dùng key riêng cho trang triển khai. Không giới hạn referrer theo đường dẫn `/<ten-repo>/` vì trình duyệt có thể chỉ gửi origin.
3. Trong GitHub repository, mở **Settings → Secrets and variables → Actions**. Tạo repository secret `GOOGLE_MAPS_API_KEY` với browser key đã giới hạn. Có thể thêm repository variable `GOOGLE_MAPS_MAP_ID` với map ID của dự án; nếu bỏ trống, app dùng `DEMO_MAP_ID` để chạy thử. Key sẽ xuất hiện trong file JavaScript đã xuất bản vì Google Maps chạy trong trình duyệt; GitHub secret chỉ tránh lưu key trong source Git.
4. Mở **Settings → Pages → Build and deployment**, chọn **GitHub Actions**. Push lên `main` hoặc chạy workflow thủ công ở tab **Actions**. URL sau khi triển khai thường là `https://<ten-tai-khoan>.github.io/<ten-repo>/`.

Kiểm tra bản tĩnh trước khi đưa lên GitHub (không dùng key thật trong lệnh có thể lưu lịch sử shell):

```powershell
$env:GOOGLE_MAPS_API_KEY = 'key-kiem-tra'
node scripts/build-pages.js
Remove-Item Env:GOOGLE_MAPS_API_KEY
```

Thư mục `dist/` chứa site tĩnh để triển khai, được bỏ qua bởi Git. Dữ liệu chuyến đi lưu trong `localStorage` theo từng origin; chuyến lưu ở localhost sẽ không tự xuất hiện trên GitHub Pages. Hãy **Tải JSON** từ bản local và **Nhập JSON** trên trang mới để chuyển chuyến đi.

## Cấu trúc

```text
public/
  index.html       # Giao diện và các màn hình
  styles.css       # Design system responsive
  app.js           # Luồng ứng dụng và tương tác UI
  services.js      # Storage, geocoding, routing, bản đồ
  data.js          # Điểm đến và địa điểm gợi ý
  config.js        # Cấu hình provider
  runtime-config.js # Placeholder; server ghi đè nội dung khi chạy local
```

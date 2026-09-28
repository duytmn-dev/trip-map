const fs = require("node:fs/promises");
const path = require("node:path");

const projectDir = path.resolve(__dirname, "..");
const publicDir = path.join(projectDir, "public");
const outputDir = path.join(projectDir, "dist");

async function buildPages() {
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!googleMapsApiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY chưa được cấu hình cho bản triển khai.");
  }

  // Chỉ xóa thư mục build cố định nằm trực tiếp trong dự án.
  if (path.dirname(outputDir) !== projectDir || path.basename(outputDir) !== "dist") {
    throw new Error("Đường dẫn thư mục build không hợp lệ.");
  }

  const config = {
    googleMapsApiKey,
    googleMapsMapId: process.env.GOOGLE_MAPS_MAP_ID?.trim() || "DEMO_MAP_ID",
  };

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.cp(publicDir, outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, "runtime-config.js"),
    `window.ROAMLY_CONFIG = ${JSON.stringify(config)};\n`,
    "utf8",
  );
  console.info("Đã tạo bản tĩnh cho GitHub Pages trong dist/.");
}

buildPages().catch((error) => {
  console.error({ error: error.message }, "Không thể tạo bản tĩnh cho GitHub Pages");
  process.exitCode = 1;
});

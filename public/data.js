const photos = {
  highland: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=85",
  forest: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1100&q=82",
  coast: "https://images.unsplash.com/photo-1732243395944-cb3ff9311091?auto=format&fit=crop&w=1100&q=82",
  heritage: "https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=1100&q=82",
  mountain: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1100&q=82",
  city: "https://images.unsplash.com/photo-1559592413-7cec4d0cae2b?auto=format&fit=crop&w=1100&q=82",
};

export const DESTINATIONS = [
  { id: "dalat", name: "Đà Lạt", region: "Lâm Đồng", center: [108.4583, 11.9404], zoom: 12.2, photo: photos.highland, tag: "Mát lành", description: "Đồi thông, hồ xanh và những quán cà phê trong sương." },
  { id: "hoian", name: "Hội An", region: "Quảng Nam", center: [108.3280, 15.8801], zoom: 13, photo: photos.heritage, tag: "Di sản", description: "Phố vàng, đèn lồng và nhịp sống chậm bên sông Hoài." },
  { id: "phuquoc", name: "Phú Quốc", region: "Kiên Giang", center: [103.9840, 10.2899], zoom: 10.5, photo: photos.coast, tag: "Biển xanh", description: "Những bãi cát êm và hoàng hôn rực rỡ nơi đảo ngọc." },
  { id: "danang", name: "Đà Nẵng", region: "Miền Trung", center: [108.2022, 16.0544], zoom: 11.5, photo: photos.city, tag: "Năng động", description: "Thành phố biển dễ đi, dễ yêu và luôn đầy năng lượng." },
  { id: "mocchau", name: "Mộc Châu", region: "Sơn La", center: [104.6511, 20.8290], zoom: 10.8, photo: photos.mountain, tag: "Cao nguyên", description: "Mùa hoa, đồi chè và những cung đường quanh co xanh ngát." },
  { id: "nhatrang", name: "Nha Trang", region: "Khánh Hòa", center: [109.1967, 12.2388], zoom: 11.5, photo: photos.coast, tag: "Nắng ấm", description: "Vịnh biển trong, hải sản ngon và nhiều đảo nhỏ để khám phá." },
];

export const DALAT_PLACES = [
  { id: "golf-valley", name: "Golf Valley Hotel", category: "hotel", address: "94 Bùi Thị Xuân, Phường 2, Đà Lạt", coordinates: [108.4428, 11.9505], rating: 4.5, duration: 0, photo: photos.highland },
  { id: "colline", name: "Hôtel Colline", category: "hotel", address: "10 Phan Bội Châu, Phường 2, Đà Lạt", coordinates: [108.4365, 11.9432], rating: 4.4, duration: 0, photo: photos.city },
  { id: "ladalat", name: "Ladalat Hotel", category: "hotel", address: "106A Mai Anh Đào, Phường 8, Đà Lạt", coordinates: [108.4495, 11.9789], rating: 4.3, duration: 0, photo: photos.forest },
  { id: "xuan-huong", name: "Hồ Xuân Hương", category: "sight", address: "Trung tâm thành phố Đà Lạt", coordinates: [108.4485, 11.9415], rating: 4.7, duration: 70, photo: photos.highland },
  { id: "lam-vien", name: "Quảng trường Lâm Viên", category: "sight", address: "Trần Quốc Toản, Phường 1, Đà Lạt", coordinates: [108.4501, 11.9368], rating: 4.6, duration: 55, photo: photos.city },
  { id: "bao-dai", name: "Dinh Bảo Đại", category: "sight", address: "1 Triệu Việt Vương, Phường 4, Đà Lạt", coordinates: [108.4298, 11.9296], rating: 4.4, duration: 80, photo: photos.heritage },
  { id: "love-valley", name: "Thung lũng Tình Yêu", category: "sight", address: "7 Mai Anh Đào, Phường 8, Đà Lạt", coordinates: [108.4491, 11.9802], rating: 4.3, duration: 150, photo: photos.forest },
  { id: "cau-dat", name: "Đồi chè Cầu Đất", category: "sight", address: "Xuân Trường, Đà Lạt", coordinates: [108.5857, 11.8828], rating: 4.5, duration: 150, photo: photos.mountain },
  { id: "dalat-market", name: "Chợ Đà Lạt", category: "sight", address: "Nguyễn Thị Minh Khai, Phường 1, Đà Lạt", coordinates: [108.4371, 11.9421], rating: 4.2, duration: 80, photo: photos.heritage },
  { id: "tui-mo-to", name: "Tiệm cà phê Túi Mơ To", category: "food", address: "Hẻm 31 Sào Nam, Phường 11, Đà Lạt", coordinates: [108.4660, 11.9534], rating: 4.4, duration: 90, photo: photos.forest },
  { id: "an-cafe", name: "An Cafe", category: "food", address: "63Bis Ba Tháng Hai, Phường 1, Đà Lạt", coordinates: [108.4337, 11.9410], rating: 4.3, duration: 75, photo: photos.highland },
  { id: "leguda", name: "Léguda Buffet Rau", category: "food", address: "Đồi Robin, Phường 3, Đà Lạt", coordinates: [108.4379, 11.9177], rating: 4.2, duration: 90, photo: photos.city },
];

export const CATEGORY_META = Object.freeze({
  hotel: { label: "Khách sạn", icon: "bed-double", color: "#0b8f69" },
  sight: { label: "Tham quan", icon: "camera", color: "#8b5cf6" },
  food: { label: "Ăn uống", icon: "utensils", color: "#f27a24" },
  other: { label: "Khác", icon: "map-pin", color: "#246bfd" },
});

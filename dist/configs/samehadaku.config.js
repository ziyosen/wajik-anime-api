const samehadakuConfig = {
    /* Situs sumber Samehadaku yang diminta bos (mirror .li).
       Parser Samehadaku yang lengkap saat ini berjalan sebagai engine
       bellonime (service internal), lihat apiBaseUrl di bawah. */
    baseUrl: "https://samehadaku.li",
    /* Engine data Samehadaku (bellonime-api) yang ditampung wajik.
       Ganti lewat env SAMEHADAKU_API_BASE_URL bila engine pindah. */
    apiBaseUrl: process.env.SAMEHADAKU_API_BASE_URL || "http://127.0.0.1:3002",
};
export default samehadakuConfig;

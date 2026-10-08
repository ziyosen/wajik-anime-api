# Riset API Anime Lengkap (2026-10-08)

Catatan riset untuk menjadikan repo ini API anime terpadu yang nanti
ditampung UI bellonime-same. Status jujur per sumber ada di bawah —
endpoint tidak ditulis "selesai" bila sumbernya belum terbukti menjawab.

## Temuan utama

1. **Samehadaku di repo ini tadinya hanya kerangka.** Route resminya
   cuma `/samehadaku` dengan status OFF dan parser kosong. Yang lengkap
   dan terbukti dipakai UI adalah implementasi di bellonime-api-backup
   (parser Cheerio penuh + pengambilan ala browser).
   - Langkah sekarang: route `/samehadaku/*` di wajik diteruskan ke
     engine bellonime (`SAMEHADAKU_API_BASE_URL`, bawaan service
     internal `127.0.0.1:3002`) supaya UI bisa langsung menampung.
   - Langkah berikutnya: port parser Samehadaku bellonime menjadi
     native di repo ini, lalu engine eksternal dimatikan.
   - Situs sumber yang dipakai: `https://samehadaku.li` (permintaan bos;
     mirror `.how` sempat tidak stabil saat dites).

2. **Pengambilan HTML diganti ala browser.** `getHTML` sekarang memakai
   got-scraping (header + sidik TLS Chrome, retry terbatas, deteksi
   halaman challenge) meniru `belloFetch` bellonime. Fetch polos terlalu
   gampang kena Cloudflare. Cookie sesi tidak dipakai di jalur ini.

3. **Otakudesu belum dapat apa-apa — penyebabnya sumber, bukan parser.**
   Domain yang dikonfigurasi (`otakudesu.blog`) menjawab 403 Cloudflare
   dari mesin uji maupun VPS. Perlu domain aktif yang terverifikasi +
   kemungkinan sesi browser yang sah; jangan diakali dengan cookie
   sembarangan. Statusnya dipantau lewat `/sumber/status`.

4. **Animekiid (sumber baru) berbasis WordPress.** REST `wp-json`
   terbuka tetapi hanya tipe standar (posts/pages), belum ada tipe
   anime khusus yang bersih. Katalognya kemungkinan di posts/kategori;
   perlu riset parser tersendiri sebelum dijanjikan sebagai endpoint.

5. **Kuramanime** sudah punya parser di repo ini dan menjawab dari
   sebagian jaringan; dari IP VPS sempat kena challenge. Lihat
   `/sumber/status` untuk kejujuran status per server.

6. **Pencarian Samehadaku diperbaiki native di wajik.** Parser lama
   membaca kartu `.animpost` dari halaman `?s=...`; tema samehadaku.li
   sekarang tidak menyajikan hasil dengan struktur itu, jadi API lama
   membalas 404 kosong. samehadaku.li membuka REST WordPress dengan
   tipe khusus `anime`, jadi `/samehadaku/search` sekarang mengambil
   `/wp-json/wp/v2/anime?search=...`, melengkapi poster dari media,
   dan membalas daftar kosong sebagai 200 (bukan 404) bila memang
   tidak ketemu.

7. **Daftar dan detail Samehadaku dilanjutkan native.** Uji satu-satu
   pada 2026-10-08 menunjukkan parser engine lama membalas 404 untuk
   ongoing, completed, popular, movies, genres, dan detail slug dari
   samehadaku.li. Route-route itu sekarang dibaca langsung di wajik:
   archive `/anime/?status=...&type=...&order=...&page=...` untuk
   ongoing/completed/popular/movies, taxonomy `/genres/{slug}` untuk
   genre, dan detail `/anime/{slug}` digabung dengan REST WordPress.
   Detail One Piece mengembalikan jendela episode terbaru yang memang
   disajikan halaman sumber (episode 1086–1180 saat diuji), bukan
   mengarang total episode. Schedule sekarang dibaca native dari
   halaman `/jadwal/` v2.samehadaku.how (struktur Alpine per hari);
   episode sudah native dari samehadaku.li. Batch sekarang juga
   native dari v2: daftar `/daftar-batch/` dan `/daftar-batch/page/N/`
   memakai kartu `.animepost`, sedangkan detail `/batch/{slug}/`
   membaca grup unduhan `#downloadb` per format/kualitas dari halaman
   sumber. Server detail gaya lama tidak dipaksakan untuk .li karena
   HTML statisnya hanya menyajikan embed bawaan episode.

## Endpoint status sumber

`GET /sumber/status` memeriksa tiap sumber dari server yang menjalankan
API ini dan membedakan: terjangkau, diblokir Cloudflare, atau mati.
Agregator/UI harus memakai ini untuk fallback, bukan menganggap kosong.

## Rencana gabung katalog (dari bos)

- Union tanpa duplikat: judul sama di banyak sumber tampil sekali,
  sumber bebas dipilih yang paling lengkap; judul unik tetap masuk.
- Kunci kanonik: judul ternormalisasi + alias (JP/EN/romaji/ID) +
  tahun + season; season/part berbeda tidak dilebur.
- Episode digabung per nomor dengan daftar sumber per episode +
  prioritas sumber, supaya ada fallback bila satu sumber mati.
- Indeks berkala + cache untuk home/jadwal/pencarian; detail live
  dengan cache TTL.

## Union katalog v1 (2026-10-08)

Endpoint baru di `/katalog`:

- `GET /katalog/terbaru` — daftar terbaru Samehadaku.li digabung
  referensi v2/Bellonime bila judulnya sama.
- `GET /katalog/search?q=...` — pencarian .li digabung hasil v2 yang
  relevan; judul sama tampil sekali dengan `sources[]`.
- `GET /katalog/ongoing` dan `/katalog/completed` — daftar .li dengan
  referensi v2 bila judulnya sama.

Kunci kanonik v1 membersihkan judul lalu memisahkan penanda
`Season N`, `Nth Season`, `S<N>`, dan `Part N`. Uji nyata sebelumnya:
100 kartu .li dan 791 kartu v2 menghasilkan 31 tumpang tindih,
termasuk variasi `4th Season` vs `Season 4` dan `2nd Season` vs `S2`.
Detail gabungan per episode dan alias JP/EN/ID masih tahap berikutnya.

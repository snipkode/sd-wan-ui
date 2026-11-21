# Model alternatif untuk sd-wan-ui

Dokumen ini merangkum model yang bisa dipakai sebagai alternatif dari konfigurasi default Wan 2.1 T2V 1.3B di UI ini. Konfigurasi default adalah:

- Diffusion: `wan2.1_t2v_1.3b-q4_k_m.gguf`
- Text encoder: `umt5-xxl-encoder-Q3_K_S.gguf`
- VAE: `taew2_1.safetensors` lewat flag `--taesd`

Versi `stable-diffusion.cpp` yang dipakai image adalah release pinned `master-1106-532d2c1` seperti tercantum di `Dockerfile`. Dokumen Wan resmi untuk commit tersebut mendukung banyak varian Wan 2.1/2.2, tetapi UI ini belum otomatis mendukung semuanya karena `server.js` masih merakit argumen dengan nama file dan flag yang tetap.

Legenda status:

- `AMAN`: keluarga model dan argumen sama dengan pipeline saat ini; cukup ganti isi file dengan nama file yang diharapkan server.
- `PERLU UBAH`: didukung oleh `sd-cli`, tetapi butuh perubahan `server.js`, file tambahan, input gambar/audio, atau flag lain.
- `DI LUAR UI`: didukung oleh `sd-cli` secara umum, tetapi bukan pipeline video Wan yang dipakai UI ini.

## Ringkasan cepat

| Kebutuhan | Alternatif | Status | Catatan |
| --- | --- | --- | --- |
| Menghemat disk/RAM | Diffusion `Q2_K` atau `Q3_K_M` | AMAN | Masih Wan2.1 T2V 1.3B, kualitas turun |
| Kualitas sedikit lebih tinggi | Diffusion `Q5_K_M` / `Q6_K` / `Q8_0` | AMAN | Butuh disk dan RAM lebih besar |
| Prompt lebih akurat | UMT5 `Q4_K_M`, `Q5_K_M`, `Q6_K` | AMAN | `Q5_K_M` atau lebih besar disarankan repo, tetapi berat |
| Detail warna/tekstur lebih bagus | Wan 2.1 VAE penuh | PERLU UBAH | Flag harus `--vae`, bukan `--taesd` |
| image-to-video, FLF2V, VACE | Wan I2V/FLF2V/VACE | PERLU UBAH | Butuh input image/video dan/atau `clip_vision` |
| Wan 2.2 A14B/TI2V/S2V | Model Wan 2.2 | PERLU UBAH | Butuh flag/model tambahan dan resource besar |
| SD1.5/SDXL/Flux | Model image lain | DI LUAR UI | UI ini memaksa mode `-M vid_gen` |

## Batasan penting sebelum mengganti model

`server.js` merakit argumen tetap di `startJob()`:

```text
-M vid_gen
--diffusion-model <MODEL_DIR>/wan2.1_t2v_1.3b-q4_k_m.gguf
--taesd <MODEL_DIR>/taew2_1.safetensors
--t5xxl <MODEL_DIR>/umt5-xxl-encoder-Q3_K_S.gguf
```

Artinya:

- Nama file di atas tidak bisa asal diganti di UI; ganti isi file dengan nama tersebut atau ubah `server.js`.
- `SD_EXTRA_ARGS` ditambahkan paling akhir, tetapi menambahkan `--diffusion-model`, `--t5xxl`, atau `--vae` duplikat tidak disarankan karena perilakunya bergantung pada cara `sd-cli` menangani argumen yang berulang.
- Mode runner lokal memakai `MODEL_DIR`, default `/root/models/wan`.
- Mode Docker mem-mount folder model sebagai `/models`; di compose default folder host adalah `./models`.
- Image offline memiliki model di dalam image, jadi penggantian file di host tidak berpengaruh sampai image offline di-build ulang.
- Host uji memiliki RAM sekitar 7.8 GB dan 2 core CPU. Model 14B/5B umumnya tidak realistis tanpa offload/swap/GPU.
- Model dengan format sama belum berarti kualitas sama. Selalu cek log `sd-cli` dan lakukan generate singkat setelah mengganti file.

## Alternatif diffusion model Wan2.1 T2V 1.3B

Semua file di bawah berasal dari repo yang sama dengan model default. Bentuk pipeline tetap Wan2.1 T2V 1.3B, sehingga statusnya `AMAN` selama file disalin ke nama yang diharapkan server.

| File asli | Ukuran | Tradeoff |
| --- | --- | --- |
| `wan2.1_t2v_1.3b-q2_k.gguf` | 579 MB | Paling hemat, kualitas paling rendah |
| `wan2.1_t2v_1.3b-q3_k_m.gguf` | 780 MB | Lebih hemat dari default, kualitas masih wajar untuk preview |
| `wan2.1_t2v_1.3b-q4_0.gguf` | 917 MB | Mirip default, sedikit lebih kecil |
| `wan2.1_t2v_1.3b-q4_1.gguf` | 978 MB | Mirip default |
| `wan2.1_t2v_1.3b-q4_k_m.gguf` | 987 MB | Default saat ini |
| `wan2.1_t2v_1.3b-q5_k_m.gguf` | ~1.14 GB | Kualitas lebih baik, butuh RAM lebih besar |
| `wan2.1_t2v_1.3b-q6_k.gguf` | ~1.25 GB | Kualitas lebih baik, model lebih besar |
| `wan2.1_t2v_1.3b-q8_0.gguf` | ~1.59 GB | Kualitas tinggi, berat untuk CPU/RAM 7.8 GB |
| `wan2.1_t2v_1.3b-f16.gguf` | 2.89 GB | Tidak disarankan di host uji |
| `wan2.1_t2v_1.3b-bf16.gguf` | 2.89 GB | Tidak disarankan di host uji |

Sumber: `https://huggingface.co/calcuis/wan-1.3b-gguf`

Rekomendasi praktis:

- Disk/RAM mepet: `q3_k_m`.
- Default seimbang: `q4_k_m`.
- Kualitas sedikit naik dan resource masih cukup: `q5_k_m`.
- Hindari `f16`/`bf16` kecuali host punya RAM besar.

Repo yang sama juga menyediakan `wan2.1-vace-1.3b-*.gguf` dan `wan2.1-v2-vace-1.3b-*.gguf`, tetapi itu keluarga VACE, bukan T2V biasa. Masuk kategori `PERLU UBAH`.

## Alternatif text encoder UMT5-XXL

Text encoder harus tetap UMT5-XXL untuk pipeline Wan. Yang bisa diubah hanya quantisasinya.

| File | Ukuran | Catatan |
| --- | --- | --- |
| `umt5-xxl-encoder-Q3_K_S.gguf` | 2.86 GB | Default saat ini, paling aman di RAM 7.8 GB |
| `umt5-xxl-encoder-Q3_K_M.gguf` | 3.06 GB | Sedikit lebih besar |
| `umt5-xxl-encoder-Q4_K_S.gguf` | 3.5 GB | Mulai terasa lebih berat |
| `umt5-xxl-encoder-Q4_K_M.gguf` | 3.66 GB | Kualitas lebih baik, perlu ruang RAM/disk lebih besar |
| `umt5-xxl-encoder-Q5_K_S.gguf` | 4.05 GB | Disarankan repo untuk hasil terbaik, tetapi berat |
| `umt5-xxl-encoder-Q5_K_M.gguf` | 4.15 GB | Disarankan repo untuk hasil terbaik, tetapi berat |
| `umt5-xxl-encoder-Q6_K.gguf` | 4.67 GB | Berat untuk host uji |
| `umt5-xxl-encoder-Q8_0.gguf` | 6.04 GB | Tidak disarankan di host uji |
| `umt5-xxl-encoder-F16.gguf` | 11.4 GB | Tidak disarankan |
| `umt5-xxl-encoder-F32.gguf` | 22.7 GB | Tidak disarankan |

Sumber: `https://huggingface.co/city96/umt5-xxl-encoder-gguf`

Repo city96 menyebut hasil terbaik umumnya mulai dari `Q5_K_M`, tetapi itu bukan imatrix quant dan ukurannya jauh lebih besar. Untuk UI yang berjalan di 2 core CPU/RAM 7.8 GB, `Q3_K_S` tetap pilihan paling realistis.

## Alternatif VAE / TAEHV

| File | Flag | Status | Catatan |
| --- | --- | --- | --- |
| `taew2_1.safetensors` | `--taesd` | AMAN | Default, ~22 MB, paling ringan |
| `wan_2.1_vae.safetensors` | `--vae` | PERLU UBAH | VAE Wan penuh, ~254 MB, detail lebih bagus tetapi decode lebih berat |
| `wan2.2_vae.safetensors` | `--vae` | PERLU UBAH | Hanya untuk Wan2.2 TI2V 5B; jangan dipakai untuk model lain |

Sumber VAE Wan 2.1: `https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/blob/main/split_files/vae/wan_2.1_vae.safetensors`

Sumber VAE Wan 2.2: `https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/blob/main/split_files/vae/wan2.2_vae.safetensors`

Jika ingin memakai VAE penuh, `server.js` perlu diubah agar tidak mengirim `--taesd` saat `--vae` dipilih. Jangan mengandalkan `SD_EXTRA_ARGS` untuk menambahkan `--vae` tanpa menguji, karena flag `--taesd` bawaan tetap terkirim.

## Varian Wan lain yang didukung sd-cli tetapi belum drop-in di UI

| Model | Kebutuhan tambahan | Status UI | Catatan |
| --- | --- | --- | --- |
| Wan2.1 T2V 14B | `wan_2.1_vae.safetensors`, biasanya `--offload-to-cpu` | PERLU UBAH | Terlalu besar untuk RAM 7.8 GB tanpa swap/GPU |
| Wan2.1 I2V 14B 480P/720P | `clip_vision_h.safetensors`, input `-i` | PERLU UBAH | UI belum punya input image awal |
| Wan2.1 FLF2V 14B 720P | `clip_vision_h.safetensors`, `--init-img`, `--end-img` | PERLU UBAH | Butuh dua image dan flag khusus |
| Wan2.1 VACE 1.3B/14B | Model task-specific, bisa butuh `-i` atau `--control-video` | PERLU UBAH | T2V bisa jadi mirip, tetapi R2V/V2V butuh input tambahan |
| Wan2.2 T2V A14B | Low-noise + high-noise diffusion model, `--high-noise-diffusion-model` | PERLU UBAH | Dua model besar; tidak muat di host uji |
| Wan2.2 I2V A14B | Dua model noise + `clip_vision_h.safetensors` + input image | PERLU UBAH | Tidak didukung UI saat ini |
| Wan2.2 TI2V 5B | `wan2.2_vae.safetensors`, model 5B | PERLU UBAH | VAE beda dengan Wan 2.1 |
| Wan2.2 S2V 14B | Audio WAV, audio encoder wav2vec2 | PERLU UBAH | Butuh input audio dan flag `--audio` |
| Wan2.2 VACE-Fun A14B | Dua expert model + input image/control | PERLU UBAH | Berat dan kompleks |

Referensi resmi: `https://github.com/leejet/stable-diffusion.cpp/blob/532d2c1/docs/models/wan.md`

## Cara pakai alternatif yang `AMAN`

Contoh mengganti diffusion model ke `q3_k_m` untuk runner lokal:

```sh
MODEL_DIR=/root/models/wan
cp "$MODEL_DIR/wan2.1_t2v_1.3b-q4_k_m.gguf" "$MODEL_DIR/wan2.1_t2v_1.3b-q4_k_m.gguf.bak"
curl -L --fail --retry 3 -o "$MODEL_DIR/wan2.1_t2v_1.3b-q4_k_m.gguf" \
  "https://huggingface.co/calcuis/wan-1.3b-gguf/resolve/main/wan2.1_t2v_1.3b-q3_k_m.gguf"
```

Contoh mengganti text encoder ke `Q4_K_M`:

```sh
MODEL_DIR=/root/models/wan
cp "$MODEL_DIR/umt5-xxl-encoder-Q3_K_S.gguf" "$MODEL_DIR/umt5-xxl-encoder-Q3_K_S.gguf.bak"
curl -L --fail --retry 3 -o "$MODEL_DIR/umt5-xxl-encoder-Q3_K_S.gguf" \
  "https://huggingface.co/city96/umt5-xxl-encoder-gguf/resolve/main/umt5-xxl-encoder-Q4_K_M.gguf"
```

Untuk Docker all-in-one/split, lakukan hal yang sama di folder host yang di-mount sebagai `/models`, Misalnya:

```sh
MODEL_DIR=./models
curl -L --fail --retry 3 -o "$MODEL_DIR/wan2.1_t2v_1.3b-q4_k_m.gguf" \
  "https://huggingface.co/calcuis/wan-1.3b-gguf/resolve/main/wan2.1_t2v_1.3b-q3_k_m.gguf"
```

Tidak perlu restart hanya karena mengganti file model yang di-mount; `sd-cli` memuat model saat job dimulai. Restart tetap diperlukan jika mengubah `server.js`, environment, atau image.

## Cara cek setelah mengganti model

```sh
ls -lh "$MODEL_DIR"
curl -s http://127.0.0.1:3001/api/health
```

Lalu jalankan satu generate singkat, misalnya:

- Mode Gambar
- Ukuran `320x256`
- Steps `4`
- CFG `6`

Periksa log di UI. Jika `sd-cli` gagal membaca model, biasanya muncul error saat load model atau saat `get_learned_condition`/`generate_video`. Jika terjadi OOM, turunkan quant text encoder/diffusion, resolusi, atau jumlah frame.

## Sumber referensi

- `https://github.com/leejet/stable-diffusion.cpp/blob/532d2c1/docs/models/wan.md`
- `https://huggingface.co/calcuis/wan-1.3b-gguf`
- `https://huggingface.co/city96/umt5-xxl-encoder-gguf`
- `https://github.com/madebyollin/taehv/tree/main/safetensors`
- `https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/tree/main/split_files/vae`

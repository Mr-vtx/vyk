#![deny(clippy::all)]

use image::{ImageReader, Limits};
use napi_derive::napi;
use ravif::{Encoder as AvifEncoder, Img, RGBA8};
use std::fs;
use std::io::Cursor;
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;
const MAX_DECODE_ALLOC_BYTES: u64 = 1024 * 1024 * 1024; 

const MAX_WEBP_DIMENSION: u32 = 16_383;
const AVIF_ENCODE_SPEED: u8 = 6;

fn encode_avif(rgba_bytes: &[u8], width: u32, height: u32, quality: f32) -> Result<Vec<u8>, String> {
    let pixels: Vec<RGBA8> = rgba_bytes
        .chunks_exact(4)
        .map(|p| RGBA8::new(p[0], p[1], p[2], p[3]))
        .collect();
    let img = Img::new(pixels.as_slice(), width as usize, height as usize);

    let result = AvifEncoder::new()
        .with_quality(quality)
        .with_speed(AVIF_ENCODE_SPEED)
        .encode_rgba(img)
        .map_err(|e| e.to_string())?;

    Ok(result.avif_file)
}

#[napi(object)]
pub struct OptimizeOptions {
     pub quality: Option<f64>,
      pub lossless: Option<bool>,
     pub dry_run: Option<bool>,
}

#[napi(object)]
pub struct OptimizeResult {
    pub input_path: String,
    pub output_path: String,
    pub original_size: u32,
    pub output_size: u32,
    pub skipped: bool,
    pub reason: Option<String>,
}

const SUPPORTED_EXTENSIONS: [&str; 3] = ["png", "jpg", "jpeg"];
const DEFAULT_QUALITY: f64 = 82.0;

#[napi]
pub fn optimize_image(
    input_path: String,
    options: Option<OptimizeOptions>,
) -> napi::Result<OptimizeResult> {
       let input_path_for_panic_msg = input_path.clone();
    panic::catch_unwind(AssertUnwindSafe(|| optimize_image_inner(input_path, options)))
        .unwrap_or_else(|panic_payload| {
            Err(napi::Error::from_reason(format!(
                "ImageForge hit an internal error while processing {input_path_for_panic_msg}: {}",
                panic_message(&panic_payload)
            )))
        })
}

fn panic_message(payload: &Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic".to_string()
    }
}

fn optimize_image_inner(
    input_path: String,
    options: Option<OptimizeOptions>,
) -> napi::Result<OptimizeResult> {
    let quality = options
        .as_ref()
        .and_then(|o| o.quality)
        .unwrap_or(DEFAULT_QUALITY)
        .clamp(0.0, 100.0) as f32;
    let lossless = options.as_ref().and_then(|o| o.lossless).unwrap_or(false);
    let dry_run = options.as_ref().and_then(|o| o.dry_run).unwrap_or(false);

    let path = Path::new(&input_path);
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if !SUPPORTED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(napi::Error::from_reason(format!(
            "Unsupported file extension: .{extension} (expected png, jpg, or jpeg)"
        )));
    }

    let original_bytes = fs::read(&input_path)
        .map_err(|e| napi::Error::from_reason(format!("Failed to read {input_path}: {e}")))?;
    let original_size = original_bytes.len();

    let mut reader = ImageReader::new(Cursor::new(&original_bytes))
        .with_guessed_format()
        .map_err(|e| napi::Error::from_reason(format!("Failed to read {input_path}: {e}")))?;

    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_DECODE_ALLOC_BYTES);
    reader.limits(limits);

    let image = reader
        .decode()
        .map_err(|e| napi::Error::from_reason(format!("Failed to decode {input_path}: {e}")))?;

    let width = image.width();
    let height = image.height();

    if width == 0 || height == 0 {
        return Err(napi::Error::from_reason(format!(
            "Decoded image has invalid dimensions: {width}x{height}"
        )));
    }

    let rgba = image.to_rgba8();
    let fits_webp = width <= MAX_WEBP_DIMENSION && height <= MAX_WEBP_DIMENSION;

    let output_path = path.with_extension(if fits_webp { "webp" } else { "avif" });
    let output_path_str = output_path.to_string_lossy().into_owned();

    let encoded_bytes: Vec<u8> = if fits_webp {
        let encoder = webp::Encoder::from_rgba(rgba.as_raw(), width, height);
        let encoded = if lossless {
            encoder.encode_lossless()
        } else {
            encoder.encode(quality)
        };
        encoded.to_vec()
    } else {
        // WebP can't hold this image (>16,383px on a side) — fall back to
        // AVIF, whose AV1 codec supports much larger frames. Slower to
        // encode, but still lands as a real optimized output instead of
        // just giving up on this file.
        encode_avif(rgba.as_raw(), width, height, quality).map_err(|e| {
            napi::Error::from_reason(format!("Failed to AVIF-encode {input_path}: {e}"))
        })?
    };
    let output_size = encoded_bytes.len();

    if output_size >= original_size {
        return Ok(OptimizeResult {
            input_path,
            output_path: output_path_str,
            original_size: original_size as u32,
            output_size: output_size as u32,
            skipped: true,
            reason: Some(format!(
                "{} output was not smaller than the original",
                if fits_webp { "WebP" } else { "AVIF" }
            )),
        });
    }

    if !dry_run {
        fs::write(&output_path, &encoded_bytes).map_err(|e| {
            napi::Error::from_reason(format!("Failed to write {output_path_str}: {e}"))
        })?;
    }

    Ok(OptimizeResult {
        input_path,
        output_path: output_path_str,
        original_size: original_size as u32,
        output_size: output_size as u32,
        skipped: false,
        reason: None,
    })
}

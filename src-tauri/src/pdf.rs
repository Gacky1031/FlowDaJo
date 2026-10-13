use lopdf::{dictionary, Document, Object, ObjectId};
use std::path::{Path, PathBuf};

fn inherited(doc: &Document, mut id: ObjectId, key: &[u8]) -> Option<Object> {
    for _ in 0..32 {
        let dict = doc.get_object(id).ok()?.as_dict().ok()?;
        if let Ok(value) = dict.get(key) {
            return Some(value.clone());
        }
        id = dict.get(b"Parent").ok()?.as_reference().ok()?;
    }
    None
}

pub fn merge_pages(files: &[PathBuf], output: &Path) -> Result<(), String> {
    merge_pages_with_crops(files, output, &[])
}

pub fn merge_pages_with_crops(
    files: &[PathBuf],
    output: &Path,
    crops: &[Option<[f64; 4]>],
) -> Result<(), String> {
    if files.is_empty() {
        return Err("No PDF pages were generated".into());
    }
    if !crops.is_empty() && crops.len() != files.len() {
        return Err("PDF crop information does not match the generated pages".into());
    }
    if files.len() == 1 && (crops.is_empty() || crops[0].is_none()) {
        let temporary = output.with_extension(format!("flowdesk-{}.tmp", std::process::id()));
        let result = std::fs::copy(&files[0], &temporary)
            .and_then(|_| std::fs::copy(&temporary, output).map(|_| ()))
            .map_err(|e| e.to_string());
        let _ = std::fs::remove_file(temporary);
        return result;
    }
    let temporary = output.with_extension(format!("flowdesk-{}.tmp", std::process::id()));
    let result = (|| {
        let mut merged = Document::with_version("1.5");
        let pages_id = merged.new_object_id();
        let mut kids = Vec::new();
        for (file_index, file) in files.iter().enumerate() {
            let mut source = Document::load(file).map_err(|e| e.to_string())?;
            source.renumber_objects_with(merged.max_id + 1);
            let source_pages = source.get_pages();
            if source_pages.is_empty() {
                return Err(format!("PDF page is empty: {}", file.display()));
            }
            for (_, page_id) in source_pages {
                let mut page = source
                    .get_object(page_id)
                    .map_err(|e| e.to_string())?
                    .as_dict()
                    .map_err(|e| e.to_string())?
                    .clone();
                for key in [b"MediaBox".as_slice(), b"CropBox", b"Resources", b"Rotate"] {
                    if page.get(key).is_err() {
                        if let Some(value) = inherited(&source, page_id, key) {
                            page.set(key, value);
                        }
                    }
                }
                if let Some(crop) = crops.get(file_index).and_then(|item| *item) {
                    let [left, bottom, width, height] = crop;
                    if !crop.iter().all(|value| value.is_finite())
                        || left < 0.0
                        || bottom < 0.0
                        || width <= 0.0
                        || height <= 0.0
                    {
                        return Err("Invalid PDF page crop".into());
                    }
                    let contents = page
                        .get(b"Contents")
                        .map_err(|e| e.to_string())?
                        .clone();
                    let mut wrapped_contents = Vec::new();
                    let prefix = format!(
                        "q 0 0 {width:.6} {height:.6} re W n 1 0 0 1 {:.6} {:.6} cm\n",
                        -left, -bottom
                    );
                    wrapped_contents.push(Object::Reference(source.add_object(
                        lopdf::Stream::new(dictionary! {}, prefix.into_bytes()),
                    )));
                    match contents {
                        Object::Array(streams) => wrapped_contents.extend(streams),
                        Object::Stream(stream) => wrapped_contents
                            .push(Object::Reference(source.add_object(stream))),
                        Object::Reference(_) => wrapped_contents.push(contents),
                        _ => return Err("Invalid PDF page contents".into()),
                    }
                    wrapped_contents.push(Object::Reference(source.add_object(
                        lopdf::Stream::new(dictionary! {}, b"\nQ\n".to_vec()),
                    )));
                    page.set("Contents", Object::Array(wrapped_contents));
                    let page_box = vec![
                        Object::Integer(0),
                        Object::Integer(0),
                        Object::Real(width as f32),
                        Object::Real(height as f32),
                    ];
                    page.set("MediaBox", Object::Array(page_box.clone()));
                    page.set("CropBox", Object::Array(page_box));
                }
                page.set("Parent", pages_id);
                source.objects.insert(page_id, Object::Dictionary(page));
                kids.push(Object::Reference(page_id));
            }
            merged.max_id = merged.max_id.max(source.max_id);
            merged.objects.extend(source.objects);
        }
        let count = kids.len() as i64;
        merged.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => kids,
                "Count" => count,
            }),
        );
        let catalog_id = merged.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        merged.trailer.set("Root", catalog_id);
        merged.save(&temporary).map_err(|e| e.to_string())?;
        std::fs::copy(&temporary, output).map_err(|e| e.to_string())?;
        Ok(())
    })();
    let _ = std::fs::remove_file(&temporary);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::Stream;

    fn write_page(path: &Path, width: i64, height: i64) {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let contents_id = doc.add_object(Stream::new(dictionary! {}, Vec::new()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Contents" => contents_id,
        });
        doc.objects.insert(pages_id, Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![Object::Reference(page_id)],
            "Count" => 1,
            "MediaBox" => vec![0.into(), 0.into(), width.into(), height.into()],
            "Resources" => dictionary! {},
        }));
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        doc.trailer.set("Root", catalog_id);
        doc.save(path).unwrap();
    }

    #[test]
    fn preserves_each_a4_orientation_and_inherited_media_box() {
        let dir = std::env::temp_dir().join(format!("flowdesk-pdf-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wide = dir.join("wide.pdf");
        let tall = dir.join("tall.pdf");
        let merged = dir.join("merged.pdf");
        write_page(&wide, 842, 595);
        write_page(&tall, 595, 842);
        merge_pages(&[wide, tall], &merged).unwrap();
        let doc = Document::load(&merged).unwrap();
        let sizes: Vec<(i64, i64)> = doc.get_pages().values().map(|id| {
            let page = doc.get_object(*id).unwrap().as_dict().unwrap();
            let box_values = page.get(b"MediaBox").unwrap().as_array().unwrap();
            (box_values[2].as_i64().unwrap(), box_values[3].as_i64().unwrap())
        }).collect();
        assert_eq!(sizes, vec![(842, 595), (595, 842)]);
        let _ = std::fs::remove_dir_all(dir);
    }
}

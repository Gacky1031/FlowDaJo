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
    if files.is_empty() {
        return Err("No PDF pages were generated".into());
    }
    let temporary = output.with_extension(format!("flowdesk-{}.tmp", std::process::id()));
    let result = (|| {
        if files.len() == 1 {
            std::fs::copy(&files[0], &temporary).map_err(|e| e.to_string())?;
        } else {
            let mut merged = Document::with_version("1.5");
            let pages_id = merged.new_object_id();
            let mut kids = Vec::new();
            for file in files {
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
        }
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

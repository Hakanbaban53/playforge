use rusqlite::{params, Connection, OptionalExtension, Result};
use std::fs;
use tauri::AppHandle;
use tauri::Manager;

const DB_NAME: &str = "app.db";

pub fn init_db(app_handle: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    log::info!("Initializing database...");
    let app_dir = app_handle.path().app_config_dir().unwrap();
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir)?;
    }
    let db_path = app_dir.join(DB_NAME);

    let conn = Connection::open(db_path)?;

    // Create products table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            unit TEXT DEFAULT 'Adet'
        )",
        [],
    )?;

    // Create product_images table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS product_images (
            id INTEGER PRIMARY KEY,
            product_id INTEGER NOT NULL,
            url TEXT NOT NULL,
            is_primary BOOLEAN NOT NULL DEFAULT 0,
            FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Create settings table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ProductImage {
    id: Option<i32>,
    url: String,
    is_primary: bool,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Product {
    id: i32,
    code: String,
    name: String,
    unit: String,
    price: f64,
    images: Vec<ProductImage>,
}

#[tauri::command]
pub fn get_product_by_code(
    app_handle: tauri::AppHandle,
    code: String,
) -> Result<Option<Product>, String> {
    let app_dir = app_handle.path().app_config_dir().unwrap();
    let db_path = app_dir.join(DB_NAME);
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, code, name, price, COALESCE(unit, 'Adet') as unit FROM products WHERE code = ?1")
        .map_err(|e| e.to_string())?;

    let product_basic: Option<(i32, String, String, f64, String)> = stmt
        .query_row(params![code], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some((id, code, name, price, unit)) = product_basic {
        // Fetch images
        let mut img_stmt = conn
            .prepare("SELECT id, url, is_primary FROM product_images WHERE product_id = ?1")
            .map_err(|e| e.to_string())?;

        let images_iter = img_stmt
            .query_map(params![id], |row| {
                Ok(ProductImage {
                    id: Some(row.get(0)?),
                    url: row.get(1)?,
                    is_primary: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut images = Vec::new();
        for img in images_iter {
            images.push(img.map_err(|e| e.to_string())?);
        }

        Ok(Some(Product {
            id,
            code,
            name,
            unit,
            price,
            images,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn add_product(
    app_handle: tauri::AppHandle,
    code: String,
    name: String,
    unit: String,
    price: f64,
    images: Vec<ProductImage>,
) -> Result<(), String> {
    log::info!(
        "Adding product: {} ({}) unit: {} with {} images",
        name,
        code,
        unit,
        images.len()
    );
    let app_dir = app_handle.path().app_config_dir().unwrap();
    let db_path = app_dir.join(DB_NAME);
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        tx.execute(
            "INSERT INTO products (code, name, unit, price) VALUES (?1, ?2, ?3, ?4)",
            params![code, name, unit, price],
        )
        .map_err(|e| e.to_string())?;

        let product_id: i32 = tx.last_insert_rowid() as i32;

        for img in images {
            tx.execute(
                "INSERT INTO product_images (product_id, url, is_primary) VALUES (?1, ?2, ?3)",
                params![product_id, img.url, img.is_primary],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn update_product(
    app_handle: tauri::AppHandle,
    code: String,
    name: String,
    unit: String,
    price: f64,
    images: Vec<ProductImage>,
) -> Result<(), String> {
    log::info!("Updating product: {} ({}) unit: {}", name, code, unit);
    let app_dir = app_handle.path().app_config_dir().unwrap();
    let db_path = app_dir.join(DB_NAME);
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        // Update product details
        tx.execute(
            "UPDATE products SET name = ?2, unit = ?3, price = ?4 WHERE code = ?1",
            params![code, name, unit, price],
        )
        .map_err(|e| e.to_string())?;

        // Get product ID
        let product_id: i32 = tx
            .query_row(
                "SELECT id FROM products WHERE code = ?1",
                params![code],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        // Replace images strategy
        tx.execute(
            "DELETE FROM product_images WHERE product_id = ?1",
            params![product_id],
        )
        .map_err(|e| e.to_string())?;

        for img in images {
            tx.execute(
                "INSERT INTO product_images (product_id, url, is_primary) VALUES (?1, ?2, ?3)",
                params![product_id, img.url, img.is_primary],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_all_products(app_handle: tauri::AppHandle) -> Result<Vec<Product>, String> {
    let app_dir = app_handle.path().app_config_dir().unwrap();
    let db_path = app_dir.join(DB_NAME);
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, code, name, price, COALESCE(unit, 'Adet') as unit FROM products")
        .map_err(|e| e.to_string())?;

    let product_iter = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i32>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut products = Vec::new();

    let mut basic_products = Vec::new();
    for p in product_iter {
        basic_products.push(p.map_err(|e| e.to_string())?);
    }

    for (id, code, name, price, unit) in basic_products {
        let mut img_stmt = conn
            .prepare("SELECT id, url, is_primary FROM product_images WHERE product_id = ?1")
            .map_err(|e| e.to_string())?;
        let images_iter = img_stmt
            .query_map(params![id], |row| {
                Ok(ProductImage {
                    id: Some(row.get(0)?),
                    url: row.get(1)?,
                    is_primary: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut images = Vec::new();
        for img in images_iter {
            images.push(img.map_err(|e| e.to_string())?);
        }

        products.push(Product {
            id,
            code,
            name,
            unit,
            price,
            images,
        });
    }

    Ok(products)
}

#[tauri::command]
pub fn save_product_image(
    app_handle: tauri::AppHandle,
    file_path: String,
) -> Result<String, String> {
    let app_dir = app_handle.path().app_config_dir().unwrap();
    let images_dir = app_dir.join("product_images");

    if !images_dir.exists() {
        fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    }

    let path = std::path::Path::new(&file_path);
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("png");
    let filename = format!("{}.{}", uuid::Uuid::new_v4(), extension);
    let destination = images_dir.join(&filename);

    fs::copy(&file_path, &destination).map_err(|e| e.to_string())?;

    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn get_setting(app_handle: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let app_dir = app_handle.path().app_config_dir().unwrap();
    let db_path = app_dir.join(DB_NAME);
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT value FROM settings WHERE key = ?1")
        .map_err(|e| e.to_string())?;

    let value: Option<String> = stmt
        .query_row(params![key], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(value)
}

#[tauri::command]
pub fn save_setting(
    app_handle: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    let app_dir = app_handle.path().app_data_dir().unwrap();
    let db_path = app_dir.join(DB_NAME);
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

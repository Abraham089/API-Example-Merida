const express = require("express");
const app = express();
const port = 3000;

app.use(express.json());

const pool = require("./connection");

app.get("/", (req, res) => {
  res.send("API de Productos y Usuarios");
});
const USER_BASE_URL = "/usuarios";
app.get(USER_BASE_URL, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM users");
    res.json(rows);
  } catch (err) {
    console.error("Error retrieving users", err);
    res.status(500).send("Error al recuperar usuarios");
  }
});

app.post(USER_BASE_URL, async (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({
      error: "Los campos nombre y email son obligatorios",
    });
  }

  try {
    const query =
      "INSERT INTO users (name, email, created_at, status) VALUES (?, ?, NOW(), ?)";
    const status = 1;

    const [result] = await pool.query(query, [name, email, status]);

    res.status(201).json({
      message: "Usuario creado exitosamente",
      id: result.insertId,
      usuario: { id: result.insertId, name, email, status },
    });
  } catch (err) {
    console.error("Error creating user", err);

    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "El email ya está registrado",
      });
    }
    res.status(500).json({
      error: "Error interno del servidor al crear el usuario",
    });
  }
});

const PRODUCT_BASE_URL = "/api/products";

app.post(PRODUCT_BASE_URL, async (req, res) => {
  const { name, description, price, stock, image } = req.body;

  if (!name || !price || price <= 0) {
    return res.status(400).json({
      error: "Los campos nombre y precio (mayor a 0) son obligatorios.",
    });
  }

  try {
    const query = `
            INSERT INTO products (name, description, price, stock, image, created_at) 
            VALUES (?, ?, ?, ?, ?, NOW())
        `;

    const [result] = await pool.query(query, [
      name,
      description || null,
      price,
      stock || 0,
      image || null,
    ]);

    res.status(201).json({
      message: "Producto creado exitosamente",
      id: result.insertId,
      producto: { id: result.insertId, name, description, price, stock, image },
    });
  } catch (err) {
    console.error("Error creating product:", err);
    res.status(500).json({
      error: "Error interno del servidor al crear el producto",
    });
  }
});

app.get(PRODUCT_BASE_URL, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM products");
    res.json(rows);
  } catch (err) {
    console.error("Error retrieving products:", err);
    res.status(500).send("Error al recuperar los productos");
  }
});

app.get(`${PRODUCT_BASE_URL}/:id`, async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await pool.query("SELECT * FROM products WHERE id = ?", [
      id,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({
        error: `Producto con ID ${id} no encontrado`,
      });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(`Error retrieving product with ID ${id}:`, err);
    res.status(500).send(`Error al recuperar el producto con ID ${id}`);
  }
});

app.put(`${PRODUCT_BASE_URL}/:id`, async (req, res) => {
  const { id } = req.params;
  const { name, description, price, stock, image } = req.body;

  if (!name && !description && !price && !stock && !image) {
    return res.status(400).json({
      error: "Se requiere al menos un campo para actualizar",
    });
  }

  try {
    const fields = [];
    const values = [];

    if (name !== undefined) {
      fields.push("name = ?");
      values.push(name);
    }
    if (description !== undefined) {
      fields.push("description = ?");
      values.push(description);
    }
    if (price !== undefined) {
      fields.push("price = ?");
      values.push(price);
    }
    if (stock !== undefined) {
      fields.push("stock = ?");
      values.push(stock);
    }
    if (image !== undefined) {
      fields.push("image = ?");
      values.push(image);
    }

    values.push(id);

    const query = `UPDATE products SET ${fields.join(", ")} WHERE id = ?`;

    const [result] = await pool.query(query, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: `Producto con ID ${id} no encontrado`,
      });
    }

    res.json({
      message: `Producto con ID ${id} actualizado exitosamente`,
      changes: result.changedRows,
    });
  } catch (err) {
    console.error(`Error updating product with ID ${id}:`, err);
    res.status(500).json({
      error: "Error interno del servidor al actualizar el producto",
    });
  }
});

app.delete(`${PRODUCT_BASE_URL}/:id`, async (req, res) => {
  const { id } = req.params;

  try {
    // SQL: DELETE FROM products WHERE id = 5;
    const [result] = await pool.query("DELETE FROM products WHERE id = ?", [
      id,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: `Producto con ID ${id} no encontrado`,
      });
    }

    res.json({
      message: `Producto con ID ${id} eliminado exitosamente`,
      deleted: result.affectedRows,
    });
  } catch (err) {
    console.error(`Error deleting product with ID ${id}:`, err);
    res.status(500).send(`Error al eliminar el producto con ID ${id}`);
  }
});

const PURCHASE_BASE_URL = "/api/purchases";
const MAX_PRODUCTS = 5;
const MAX_TOTAL = 3500.0;

app.post(PURCHASE_BASE_URL, async (req, res) => {
  const { user_id, status, details } = req.body;
  let connection;

  if (!user_id || !status || !details || details.length === 0) {
    return res.status(400).json({
      error:
        "Todos los campos (user_id, status, details) son obligatorios y debe haber al menos un producto.",
    });
  }
  if (details.length > MAX_PRODUCTS) {
    return res.status(400).json({
      error: `No se pueden guardar más de ${MAX_PRODUCTS} productos por compra.`,
    });
  }

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    let totalCompra = 0;
    const purchaseDetails = [];

    for (const item of details) {
      const { product_id, quantity, price } = item;

      if (!product_id || !quantity || !price || quantity <= 0 || price <= 0) {
        await connection.rollback();
        return res.status(400).json({
          error:
            "Cada detalle de producto debe tener id, cantidad (>0) y precio (>0).",
        });
      }

      const [productRows] = await connection.query(
        "SELECT stock, price FROM products WHERE id = ?",
        [product_id]
      );

      if (productRows.length === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ error: `Producto con ID ${product_id} no encontrado.` });
      }

      const currentStock = productRows[0].stock;
      if (currentStock < quantity) {
        await connection.rollback();
        return res.status(400).json({
          error: `Stock insuficiente para el producto ID ${product_id}. Disponible: ${currentStock}`,
        });
      }

      const subtotal = quantity * price;
      totalCompra += subtotal;
      purchaseDetails.push({ ...item, subtotal });
    }

    if (totalCompra > MAX_TOTAL) {
      await connection.rollback();
      return res.status(400).json({
        error: `El total de la compra (${totalCompra.toFixed(
          2
        )}) no puede pasar de $${MAX_TOTAL}.`,
      });
    }

    const purchaseQuery =
      "INSERT INTO purchases (user_id, total, status, purchase_date) VALUES (?, ?, ?, NOW())";
    const [purchaseResult] = await connection.query(purchaseQuery, [
      user_id,
      totalCompra,
      status,
    ]);
    const purchase_id = purchaseResult.insertId;

    for (const item of purchaseDetails) {
      const { product_id, quantity, price, subtotal } = item;

      const detailQuery =
        "INSERT INTO purchase_details (purchase_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)";
      await connection.query(detailQuery, [
        purchase_id,
        product_id,
        quantity,
        price,
        subtotal,
      ]);

      const stockUpdateQuery =
        "UPDATE products SET stock = stock - ? WHERE id = ?";
      await connection.query(stockUpdateQuery, [quantity, product_id]);
    }

    await connection.commit();
    res.status(201).json({
      message: "Compra y detalles creados exitosamente. Stock descontado.",
      purchase_id: purchase_id,
      total: totalCompra.toFixed(2),
    });
  } catch (err) {
    console.error("Error durante la creación de la compra:", err);
    if (connection) {
      await connection.rollback();
    }
    res
      .status(500)
      .json({ error: "Error interno del servidor al procesar la compra." });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`);
});

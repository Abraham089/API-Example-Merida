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

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`);
});

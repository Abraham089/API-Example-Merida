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

app.put(`${PURCHASE_BASE_URL}/:id`, async (req, res) => {
  const { id } = req.params;
  const { user_id, status, details } = req.body;
  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [currentPurchaseRows] = await connection.query(
      "SELECT user_id, status FROM purchases WHERE id = ? FOR UPDATE",
      [id]
    );

    if (currentPurchaseRows.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ error: `Compra con ID ${id} no encontrada.` });
    }

    const currentStatus = currentPurchaseRows[0].status;
    if (currentStatus === "COMPLETED") {
      await connection.rollback();
      return res.status(400).json({
        error: 'No se puede modificar una compra con estatus "COMPLETED".',
      });
    }

    const updateFields = [];
    const updateValues = [];

    if (user_id !== undefined) {
      updateFields.push("user_id = ?");
      updateValues.push(user_id);
    }
    if (status !== undefined) {
      updateFields.push("status = ?");
      updateValues.push(status);
    }

    if (updateFields.length > 0) {
      const purchaseUpdateQuery = `UPDATE purchases SET ${updateFields.join(
        ", "
      )} WHERE id = ?`;
      await connection.query(purchaseUpdateQuery, [...updateValues, id]);
    }

    if (details && details.length > 0) {
      if (details.length > MAX_PRODUCTS) {
        await connection.rollback();
        return res.status(400).json({
          error: `No se pueden guardar más de ${MAX_PRODUCTS} productos por compra.`,
        });
      }

      const [oldDetails] = await connection.query(
        "SELECT product_id, quantity FROM purchase_details WHERE purchase_id = ?",
        [id]
      );
      for (const oldItem of oldDetails) {
        await connection.query(
          "UPDATE products SET stock = stock + ? WHERE id = ?",
          [oldItem.quantity, oldItem.product_id]
        );
      }

      await connection.query(
        "DELETE FROM purchase_details WHERE purchase_id = ?",
        [id]
      );

      let newTotalCompra = 0;
      const newPurchaseDetails = [];

      for (const newItem of details) {
        const { product_id, quantity, price } = newItem;

        if (!product_id || !quantity || !price || quantity <= 0 || price <= 0) {
          await connection.rollback();
          return res.status(400).json({
            error:
              "Cada detalle de producto debe tener id, cantidad (>0) y precio (>0).",
          });
        }

        const [productRows] = await connection.query(
          "SELECT stock FROM products WHERE id = ?",
          [product_id]
        );
        const currentStock = productRows[0].stock;

        if (currentStock < quantity) {
          await connection.rollback();
          return res.status(400).json({
            error: `Stock insuficiente para el producto ID ${product_id}. Disponible: ${currentStock}`,
          });
        }

        const subtotal = quantity * price;
        newTotalCompra += subtotal;
        newPurchaseDetails.push({ ...newItem, subtotal });
      }

      if (newTotalCompra > MAX_TOTAL) {
        await connection.rollback();
        return res.status(400).json({
          error: `El total de la compra (${newTotalCompra.toFixed(
            2
          )}) no puede pasar de $${MAX_TOTAL}.`,
        });
      }

      for (const item of newPurchaseDetails) {
        const { product_id, quantity, price, subtotal } = item;
        const detailQuery =
          "INSERT INTO purchase_details (purchase_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)";
        await connection.query(detailQuery, [
          id,
          product_id,
          quantity,
          price,
          subtotal,
        ]);

        await connection.query(
          "UPDATE products SET stock = stock - ? WHERE id = ?",
          [quantity, product_id]
        );
      }

      await connection.query("UPDATE purchases SET total = ? WHERE id = ?", [
        newTotalCompra,
        id,
      ]);
    }

    await connection.commit();
    res.json({
      message: `Compra con ID ${id} actualizada exitosamente.`,
      status: status || currentStatus,
    });
  } catch (err) {
    console.error("Error durante la actualización de la compra:", err);
    if (connection) {
      await connection.rollback();
    }
    res.status(500).json({
      error:
        "Error interno del servidor al procesar la actualización de la compra.",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

app.delete(`${PURCHASE_BASE_URL}/:id`, async (req, res) => {
  const { id } = req.params;
  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [purchaseRows] = await connection.query(
      "SELECT status FROM purchases WHERE id = ? FOR UPDATE",
      [id]
    );

    if (purchaseRows.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ error: `Compra con ID ${id} no encontrada.` });
    }

    if (purchaseRows[0].status === "COMPLETED") {
      await connection.rollback();
      return res.status(400).json({
        error: 'No se pueden borrar compras con estatus "COMPLETED".',
      });
    }

    const [detailsRows] = await connection.query(
      "SELECT product_id, quantity FROM purchase_details WHERE purchase_id = ?",
      [id]
    );

    for (const item of detailsRows) {
      await connection.query(
        "UPDATE products SET stock = stock + ? WHERE id = ?",
        [item.quantity, item.product_id]
      );
    }

    await connection.query(
      "DELETE FROM purchase_details WHERE purchase_id = ?",
      [id]
    );

    const [deleteResult] = await connection.query(
      "DELETE FROM purchases WHERE id = ?",
      [id]
    );

    await connection.commit();

    res.json({
      message: `Compra con ID ${id} eliminada exitosamente. Stock devuelto.`,
      deleted: deleteResult.affectedRows,
    });
  } catch (err) {
    console.error("Error durante la eliminación de la compra:", err);
    if (connection) {
      await connection.rollback();
    }
    res
      .status(500)
      .json({ error: "Error interno del servidor al eliminar la compra." });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

app.get(`${PURCHASE_BASE_URL}/:id`, async (req, res) => {
  const { id } = req.params;

  try {
    const query = `
            SELECT 
                p.id AS purchase_id, p.total, p.status, p.purchase_date,
                u.name AS user_name,
                pd.id AS detail_id, pd.quantity, pd.price AS detail_price, pd.subtotal,
                pr.name AS product_name
            FROM purchases p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN purchase_details pd ON p.id = pd.purchase_id
            LEFT JOIN products pr ON pd.product_id = pr.id
            WHERE p.id = ?
            ORDER BY pd.id;
        `;

    const [rows] = await pool.query(query, [id]);

    if (rows.length === 0 || rows[0].purchase_id === null) {
      return res
        .status(404)
        .json({ error: `Compra con ID ${id} no encontrada.` });
    }

    const purchase = {
      id: rows[0].purchase_id,
      user: rows[0].user_name,
      total: rows[0].total,
      status: rows[0].status,
      purchase_date: rows[0].purchase_date,
      details: [],
    };

    if (rows[0].detail_id !== null) {
      rows.forEach((row) => {
        purchase.details.push({
          id: row.detail_id,
          product: row.product_name,
          quantity: row.quantity,
          price: row.detail_price,
          subtotal: row.subtotal,
        });
      });
    }

    res.json(purchase);
  } catch (err) {
    console.error(`Error retrieving purchase with ID ${id}:`, err);
    res
      .status(500)
      .json({ error: "Error interno del servidor al recuperar la compra." });
  }
});

app.get(PURCHASE_BASE_URL, async (req, res) => {
  try {
    const query = `
            SELECT 
                p.id AS purchase_id, p.total, p.status, p.purchase_date,
                u.name AS user_name,
                pd.id AS detail_id, pd.quantity, pd.price AS detail_price, pd.subtotal,
                pr.name AS product_name
            FROM purchases p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN purchase_details pd ON p.id = pd.purchase_id
            LEFT JOIN products pr ON pd.product_id = pr.id
            ORDER BY p.id, pd.id;
        `;

    const [rows] = await pool.query(query);

    if (rows.length === 0) {
      return res.json([]);
    }

    const purchasesMap = new Map();

    rows.forEach((row) => {
      if (!purchasesMap.has(row.purchase_id)) {
        purchasesMap.set(row.purchase_id, {
          id: row.purchase_id,
          user: row.user_name,
          total: row.total,
          status: row.status,
          purchase_date: row.purchase_date,
          details: [],
        });
      }

      if (row.detail_id !== null) {
        purchasesMap.get(row.purchase_id).details.push({
          id: row.detail_id,
          product: row.product_name,
          quantity: row.quantity,
          price: row.detail_price,
          subtotal: row.subtotal,
        });
      }
    });

    res.json(Array.from(purchasesMap.values()));
  } catch (err) {
    console.error("Error retrieving all purchases:", err);
    res
      .status(500)
      .json({ error: "Error interno del servidor al recuperar las compras." });
  }
});

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`);
});

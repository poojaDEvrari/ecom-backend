const express = require("express")
const mongoose = require("mongoose")
const cors = require("cors")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const nodemailer = require("nodemailer")
const crypto = require("crypto")
const Razorpay = require("razorpay")
const { OAuth2Client } = require("google-auth-library")
const fetch = require("node-fetch") 
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const multer = require('multer');


require("dotenv").config()
const app = express()
const invoicesDir = path.join(__dirname, 'invoices');
if (!fs.existsSync(invoicesDir)) {
  fs.mkdirSync(invoicesDir, { recursive: true });
}
// Middleware
app.use(cors())
app.use(express.json())

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
})

// Google OAuth2 Client
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID"
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID)

// MongoDB Connection
mongoose.connect(
  process.env.MONGODB_URI ||
    "mongodb+srv://pooja:123@cluster0.vs62poi.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  },
)

mongoose.connection.on("connected", () => {
  console.log("MongoDB connected successfully")
})

// Cart Schema - NEW
const cartSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  items: [
    {
      productId: { type: String, required: true }, // Can be ObjectId or string
      name: { type: String, required: true },
      price: { type: Number, required: true },
      imageUrl: { type: String },
      category: { type: String },
      unit: { type: String, required: true },
      quantity: { type: Number, required: true, min: 1 },
      discount: { type: Number, default: 0 }, // Discount percentage (0-100)
      tax: { type: Number, default: 0 },      // Tax percentage (0-100)
      hasVAT: { type: Boolean, default: false }, // VAT applicability
      addedAt: { type: Date, default: Date.now },
    },
  ],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
})

// Create compound index for efficient queries
cartSchema.index({ userId: 1 })
cartSchema.index({ userId: 1, "items.productId": 1 })

// Address Schema
const addressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true }, // Home, Office, etc.
  name: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  pincode: { type: String, required: true },
  isDefault: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
})

// Order Schema
const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  orderId: { type: String, unique: true, required: true },
  items: [
    {
      itemId: { type: mongoose.Schema.Types.ObjectId, ref: "Item" },
      name: { type: String, required: true },
      price: { type: Number, required: true },
      quantity: { type: Number, required: true },
      sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      sellerName: { type: String },
    },
  ],
  address: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
  },
  paymentMethod: { type: String, enum: ["cod", "online"], required: true },
  paymentStatus: { type: String, enum: ["pending", "paid", "failed", "refunded"], default: "pending" },
  paymentId: { type: String }, // Razorpay payment ID
  razorpayOrderId: { type: String }, // Razorpay order ID
  subtotal: { type: Number, required: true },
  deliveryFee: { type: Number, required: true },
  taxAmount: { type: Number, required: true },
  totalAmount: { type: Number, required: true },
  specialRequests: {type: String, default: null, maxLength: 200},
  orderStatus: {
    type: String,
    enum: ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"],
    default: "pending",
  },
  estimatedDelivery: { type: Date },
  deliveredAt: { type: Date },
  cancelledAt: { type: Date },
  cancellationReason: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
})

// User Schema - Updated with address reference
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  userType: { type: String, enum: ["buyer", "seller", "admin"], default: "buyer" },
  profileImage: { type: String },
  storeName: { type: String },
  storeAddress: { type: String },
  businessLicense: { type: String },
  isVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  sellerRequestStatus: { type: String, enum: ["none", "pending", "approved", "rejected"], default: "none" },
  // Address fields removed from user schema as we now have separate Address model
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
})

const sellerRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  userName: { type: String, required: true },
  userEmail: { type: String, required: true },
  storeName: { type: String, required: true },
  storeAddress: { type: String, required: true },
  businessLicense: { type: String },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  requestedAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  rejectionReason: { type: String },
  createdAt: { type: Date, default: Date.now },
})

const itemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, required: true },
  imageUrl: { type: String },
  quantity: { type: Number, required: true },
  unit: { type: String, required: true },
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  sellerName: { type: String, required: true },
  storeName: { type: String },
  isAvailable: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  discount: { type: Number, default: 0 }, // Discount percentage (0-100)
  tax: { type: Number, default: 0 },      // Tax percentage (0-100)
  hasVAT: { type: Boolean, default: false }, // VAT applicability
})

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true },
  otp: { type: String, required: true },
  token: { type: String },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
})

// Models
const User = mongoose.model("User", userSchema)
const Cart = mongoose.model("Cart", cartSchema)
const Address = mongoose.model("Address", addressSchema)
const Order = mongoose.model("Order", orderSchema)
const SellerRequest = mongoose.model("SellerRequest", sellerRequestSchema)
const Item = mongoose.model("Item", itemSchema)
const OTP = mongoose.model("OTP", otpSchema)

// Configure email transporter
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
})

// JWT Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"]
  const token = authHeader && authHeader.split(" ")[1]
  if (!token) {
    return res.status(401).json({ success: false, message: "Access token required" })
  }
  jwt.verify(token, process.env.JWT_SECRET || "your-secret-key", (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: "Invalid token" })
    }
    req.user = user
    next()
  })
}

// Admin Middleware
const requireAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id)
    if (!user || user.userType !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      })
    }
    next()
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error verifying admin status",
    })
  }
}

// Generate a 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// Generate unique order ID
function generateOrderId() {
  const timestamp = Date.now().toString()
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")
  return `ORD${timestamp}${random}`
}

// =============================================================================
// EMAIL FUNCTIONS
// =============================================================================

// Send signup email
async function sendSignupMail({ name, email, phone }) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Welcome to Our Platform!",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #333; text-align: center;">Welcome, ${name}!</h2>
        <p>Thank you for signing up at our platform. Here are your registration details:</p>
        <ul>
          <li><b>Name:</b> ${name}</li>
          <li><b>Email:</b> ${email}</li>
          <li><b>Phone:</b> ${phone}</li>
        </ul>
        <p>We're excited to have you on board!</p>
        <p style="margin-top: 30px; font-size: 12px; color: #777; text-align: center;">
          This is an automated email. Please do not reply.
        </p>
      </div>
    `,
  }
  await transporter.sendMail(mailOptions)
}

// Send order confirmation email
async function sendOrderConfirmationEmail(user, order) {
  const itemsList = order.items.map((item) => `<li>${item.name} - Qty: ${item.quantity} - BHD${item.price}</li>`).join("")
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: `Order Confirmation - ${order.orderId}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #4CAF50; text-align: center;">Order Confirmed!</h2>
        <p>Hello ${user.name},</p>
        <p>Thank you for your order. Here are the details:</p>
                <div style="background-color: #f5f5f5; padding: 15px; margin: 20px 0; border-radius: 5px;">
          <h3>Order Details</h3>
          <p><strong>Order ID:</strong> ${order.orderId}</p>
          <p><strong>Total Amount:</strong> BHD${order.totalAmount}</p>
          <p><strong>Payment Method:</strong> ${order.paymentMethod === "cod" ? "Cash on Delivery" : "Online Payment"}</p>
          <p><strong>Payment Status:</strong> ${order.paymentStatus}</p>
          <p><strong>Estimated Delivery:</strong> ${order.estimatedDelivery.toDateString()}</p>
        </div>
        <div style="background-color: #f9f9f9; padding: 15px; margin: 20px 0; border-radius: 5px;">
          <h3>Items Ordered</h3>
          <ul>${itemsList}</ul>
        </div>
        <div style="background-color: #f0f8ff; padding: 15px; margin: 20px 0; border-radius: 5px;">
          <h3>Delivery Address</h3>
          <p>${order.address.name}<br>
          ${order.address.phone}<br>
          ${order.address.address}<br>
          ${order.address.city}, ${order.address.state} - ${order.address.pincode}</p>
        </div>
        <p>We'll keep you updated on your order status.</p>
        <p>Thank you for shopping with us!</p>
                <p style="margin-top: 30px; font-size: 12px; color: #777; text-align: center;">
          This is an automated email. Please do not reply.
        </p>
      </div>
    `,
  }
  await transporter.sendMail(mailOptions)
}

// =============================================================================
// CART MANAGEMENT APIs
// =============================================================================

// Get user's cart items
app.get("/api/cart/:userId", authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId
    // Verify user can only access their own cart
    if (req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      })
    }
    
    const cart = await Cart.findOne({ userId })
    if (!cart) {
      return res.json({
        success: true,
        cartItems: [],
        totalItems: 0,
        totalPrice: 0,
      })
    }
    
    // Calculate totals with discount and tax
    const totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0)
    const totalPrice = cart.items.reduce((sum, item) => {
      const originalPrice = item.price
      const discountedPrice = originalPrice * (1 - (item.discount || 0) / 100)
      const finalPrice = discountedPrice * (1 + (item.tax || 0) / 100)
      return sum + (finalPrice * item.quantity)
    }, 0)
    
    res.json({
      success: true,
      cartItems: cart.items.map((item) => ({
        _id: item.productId,
        productId: item.productId,
        name: item.name,
        price: item.price,
        imageUrl: item.imageUrl,
        category: item.category,
        unit: item.unit,
        quantity: item.quantity,
        discount: item.discount || 0,
        tax: item.tax || 0,
        hasVAT: item.hasVAT || false,
        addedAt: item.addedAt,
      })),
      totalItems,
      totalPrice: Math.round(totalPrice * 100) / 100, // Round to 2 decimal places
    })
  } catch (error) {
    console.error("Get cart error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch cart items",
    })
  }
})

// Add item to user's cart
app.post("/api/cart/add", authenticateToken, async (req, res) => {
  try {
    const { userId, productId, quantity = 1 } = req.body
    
    // Verify user can only modify their own cart
    if (req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      })
    }
    
    // Fetch complete product data from database
    const product = await Item.findById(productId)
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      })
    }
    
    // Find or create cart for user
    let cart = await Cart.findOne({ userId })
    if (!cart) {
      cart = new Cart({
        userId,
        items: [],
      })
    }
    
    // Check if item already exists in cart
    const existingItemIndex = cart.items.findIndex((item) => item.productId === productId)
    if (existingItemIndex > -1) {
      // Update quantity if item exists
      cart.items[existingItemIndex].quantity += quantity
      cart.items[existingItemIndex].addedAt = new Date()
      // Update with latest product data
      cart.items[existingItemIndex].discount = product.discount || 0
      cart.items[existingItemIndex].tax = product.tax || 0
      cart.items[existingItemIndex].hasVAT = product.hasVAT || false
    } else {
      // Add new item to cart with complete product data
      cart.items.push({
        productId,
        name: product.name,
        price: product.price,
        imageUrl: product.imageUrl || "",
        category: product.category || "",
        unit: product.unit,
        quantity: Number.parseInt(quantity),
        discount: product.discount || 0,
        tax: product.tax || 0,
        hasVAT: product.hasVAT || false,
        addedAt: new Date(),
      })
    }
    
    cart.updatedAt = new Date()
    await cart.save()
    
    res.json({
      success: true,
      message: "Item added to cart successfully",
      cartItemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
    })
  } catch (error) {
    console.error("Add to cart error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to add item to cart",
    })
  }
})

// Remove item from user's cart
app.delete("/api/cart/remove", authenticateToken, async (req, res) => {
  try {
    const { userId, productId } = req.body
    // Verify user can only modify their own cart
    if (req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      })
    }
    const cart = await Cart.findOne({ userId })
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      })
    }
    // Find and remove the item
    const itemIndex = cart.items.findIndex((item) => item.productId === productId)
    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Item not found in cart",
      })
    }
    cart.items.splice(itemIndex, 1)
    cart.updatedAt = new Date()
    // If cart is empty, you might want to delete the cart document
    if (cart.items.length === 0) {
      await Cart.deleteOne({ userId })
    } else {
      await cart.save()
    }
    res.json({
      success: true,
      message: "Item removed from cart successfully",
      cartItemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
    })
  } catch (error) {
    console.error("Remove from cart error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to remove item from cart",
    })
  }
})

// Update item quantity in user's cart
app.put("/api/cart/update", authenticateToken, async (req, res) => {
  try {
    const { userId, productId, quantity } = req.body
    // Verify user can only modify their own cart
    if (req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      })
    }
    if (!quantity || quantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be at least 1",
      })
    }
    const cart = await Cart.findOne({ userId })
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      })
    }
    // Find and update the item
    const itemIndex = cart.items.findIndex((item) => item.productId === productId)
    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Item not found in cart",
      })
    }
    cart.items[itemIndex].quantity = Number.parseInt(quantity)
    cart.items[itemIndex].addedAt = new Date() // Update timestamp
    cart.updatedAt = new Date()
    await cart.save()
    res.json({
      success: true,
      message: "Cart updated successfully",
      cartItemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
    })
  } catch (error) {
    console.error("Update cart error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to update cart",
    })
  }
})

// Clear user's entire cart
app.delete("/api/cart/clear/:userId", authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId
    // Verify user can only modify their own cart
    if (req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      })
    }
    await Cart.deleteOne({ userId })
    res.json({
      success: true,
      message: "Cart cleared successfully",
      cartItemCount: 0,
    })
  } catch (error) {
    console.error("Clear cart error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to clear cart",
    })
  }
})

// Get cart item count for user (utility endpoint)
app.get("/api/cart/:userId/count", authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId
    // Verify user can only access their own cart
    if (req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      })
    }
    const cart = await Cart.findOne({ userId })
    const count = cart ? cart.items.reduce((sum, item) => sum + item.quantity, 0) : 0
    res.json({
      success: true,
      count,
    })
  } catch (error) {
    console.error("Get cart count error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to get cart count",
    })
  }
})

// =============================================================================
// ADDRESS MANAGEMENT APIs
// =============================================================================

// Get user addresses
app.get("/api/addresses", authenticateToken, async (req, res) => {
  try {
    const addresses = await Address.find({ userId: req.user.id }).sort({ isDefault: -1, createdAt: -1 }).limit(3) // Limit to 3 addresses as per frontend
    res.json({
      success: true,
      addresses,
    })
  } catch (error) {
    console.error("Get addresses error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch addresses",
    })
  }
})

// Add new address
app.post("/api/addresses", authenticateToken, async (req, res) => {
  try {
    const { title, name, phone, address, city, state, pincode, isDefault } = req.body
    // Validate required fields
    if (!title || !name || !phone || !address || !city || !state || !pincode) {
      return res.status(400).json({
        success: false,
        message: "All address fields are required",
      })
    }
    // Validate pincode
    if (pincode.length !== 6) {
      return res.status(400).json({
        success: false,
        message: "Pincode must be 6 digits",
      })
    }
    // Validate phone
    if (phone.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be at least 10 digits",
      })
    }
    // Check if user already has 3 addresses
    const existingAddresses = await Address.countDocuments({ userId: req.user.id })
    if (existingAddresses >= 3) {
      return res.status(400).json({
        success: false,
        message: "Maximum 3 addresses allowed per user",
      })
    }
    // If this is set as default, remove default from other addresses
    if (isDefault) {
      await Address.updateMany({ userId: req.user.id }, { isDefault: false })
    }
    // If this is the first address, make it default
    const shouldBeDefault = existingAddresses === 0 || isDefault
    const newAddress = new Address({
      userId: req.user.id,
      title,
      name,
      phone,
      address,
      city,
      state,
      pincode,
      isDefault: shouldBeDefault,
    })
    await newAddress.save()
    res.status(201).json({
      success: true,
      message: "Address added successfully",
      address: newAddress,
    })
  } catch (error) {
    console.error("Add address error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to add address",
    })
  }
})

// Update address
app.put("/api/addresses/:id", authenticateToken, async (req, res) => {
  try {
    const addressId = req.params.id
    const { title, name, phone, address, city, state, pincode, isDefault } = req.body
    const existingAddress = await Address.findOne({
      _id: addressId,
      userId: req.user.id,
    })
    if (!existingAddress) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
      })
    }
    // If setting as default, remove default from other addresses
    if (isDefault && !existingAddress.isDefault) {
      await Address.updateMany({ userId: req.user.id, _id: { $ne: addressId } }, { isDefault: false })
    }
    const updatedAddress = await Address.findByIdAndUpdate(
      addressId,
      {
        title,
        name,
        phone,
        address,
        city,
        state,
        pincode,
        isDefault,
        updatedAt: new Date(),
      },
      { new: true },
    )
    res.json({
      success: true,
      message: "Address updated successfully",
      address: updatedAddress,
    })
  } catch (error) {
    console.error("Update address error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to update address",
    })
  }
})

// Delete address
app.delete("/api/addresses/:id", authenticateToken, async (req, res) => {
  try {
    const addressId = req.params.id
    const address = await Address.findOneAndDelete({
      _id: addressId,
      userId: req.user.id,
    })
    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
      })
    }
    // If deleted address was default, make another address default
    if (address.isDefault) {
      const firstAddress = await Address.findOne({ userId: req.user.id })
      if (firstAddress) {
        firstAddress.isDefault = true
        await firstAddress.save()
      }
    }
    res.json({
      success: true,
      message: "Address deleted successfully",
    })
  } catch (error) {
    console.error("Delete address error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to delete address",
    })
  }
})

// =============================================================================
// AUTHENTICATION APIs
// =============================================================================

// User Info Update API
app.put("/api/user/update-info", authenticateToken, async (req, res) => {
  try {
    const { name, phone } = req.body
    if (!name && !phone) {
      return res.status(400).json({ success: false, message: "Nothing to update" })
    }
    if (phone) {
      const phoneExists = await User.findOne({ phone, _id: { $ne: req.user.id } })
      if (phoneExists) {
        return res.status(400).json({ success: false, message: "Phone number already exists." })
      }
    }
    const user = await User.findById(req.user.id)
    if (!user) return res.status(404).json({ success: false, message: "User not found" })
    if (name) user.name = name
    if (phone) user.phone = phone
    user.updatedAt = new Date()
    await user.save()
    res.json({
      success: true,
      message: "User information updated successfully",
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        userType: user.userType,
      },
    })
  } catch (error) {
    console.error("Update info error:", error)
    res.status(500).json({ success: false, message: "Failed to update user info" })
  }
})

// Register User (With OTP verification)
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }],
    })
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email or phone number.",
      })
    }
    const hashedPassword = await bcrypt.hash(password, 10)
    const user = new User({
      name,
      email,
      phone,
      password: hashedPassword,
      userType: "buyer",
      isVerified: false,
    })
    await user.save()
    const otp = generateOTP()
    const expiresAt = new Date()
    expiresAt.setMinutes(expiresAt.getMinutes() + 15)
    await OTP.deleteMany({ email })
    const otpDoc = new OTP({
      email,
      otp,
      expiresAt,
    })
    await otpDoc.save()
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Signup OTP Verification",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
          <h2 style="color: #333; text-align: center;">OTP Verification</h2>
          <p>Hello ${name},</p>
          <p>Your OTP for verifying your account is:</p>
          <div style="background-color: #f5f5f5; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
            ${otp}
          </div>
          <p>This OTP will expire in 15 minutes.</p>
          <p>If you did not sign up, please ignore this email.</p>
          <p style="margin-top: 30px; font-size: 12px; color: #777; text-align: center;">
            This is an automated email. Please do not reply.
          </p>
        </div>
      `,
    }
    await transporter.sendMail(mailOptions)
    res.status(201).json({
      success: true,
      message: "Account created! Please verify your email with the OTP sent.",
    })
  } catch (error) {
    console.error("Signup error:", error)
    res.status(500).json({
      success: false,
      message: "An error occurred during signup. Please try again.",
    })
  }
})

// Verify Signup OTP
app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      })
    }
    const otpDoc = await OTP.findOne({ email, otp })
    if (!otpDoc) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      })
    }
    if (new Date() > otpDoc.expiresAt) {
      await OTP.deleteOne({ _id: otpDoc._id })
      return res.status(400).json({
        success: false,
        message: "OTP has expired",
      })
    }
    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      })
    }
    user.isVerified = true
    user.updatedAt = new Date()
    await user.save()
    await OTP.deleteOne({ _id: otpDoc._id })
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET || "your-secret-key", {
      expiresIn: "7d",
    })
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userType: user.userType,
      profileImage: user.profileImage,
      createdAt: user.createdAt,
      isVerified: user.isVerified,
    }
    res.json({
      success: true,
      message: "Email verified successfully!",
      user: userData,
      token,
    })
  } catch (error) {
    console.error("Verify signup otp error:", error)
    res.status(500).json({
      success: false,
      message: "An error occurred while verifying OTP",
    })
  }
})

// Send OTP for password reset
app.post("/api/forgot-password", async (req, res) => {
  try {
    const { email } = req.body
    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      })
    }
    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "No user found with this email address",
      })
    }
    const otp = generateOTP()
    const expiresAt = new Date()
    expiresAt.setMinutes(expiresAt.getMinutes() + 15)
    await OTP.deleteMany({ email })
    const otpDoc = new OTP({
      email,
      otp,
      expiresAt,
    })
    await otpDoc.save()
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Password Reset OTP",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
          <h2 style="color: #333; text-align: center;">Password Reset</h2>
          <p>Hello ${user.name},</p>
          <p>You requested to reset your password. Please use the following OTP to verify your identity:</p>
          <div style="background-color: #f5f5f5; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
            ${otp}
          </div>
          <p>This OTP will expire in 15 minutes.</p>
          <p>If you didn't request this password reset, please ignore this email or contact support if you have concerns.</p>
          <p style="margin-top: 30px; font-size: 12px; color: #777; text-align: center;">
            This is an automated email. Please do not reply.
          </p>
        </div>
      `,
    }
    await transporter.sendMail(mailOptions)
    res.status(200).json({
      success: true,
      message: "OTP sent to your email address",
    })
  } catch (error) {
    console.error("Forgot password error:", error)
    res.status(500).json({
      success: false,
      error: "An error occurred while processing your request",
    })
  }
})

// Verify OTP for password reset
app.post("/api/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        error: "Email and OTP are required",
      })
    }
    const otpDoc = await OTP.findOne({ email, otp })
    if (!otpDoc) {
      return res.status(400).json({
        success: false,
        error: "Invalid OTP",
      })
    }
    if (new Date() > otpDoc.expiresAt) {
      await OTP.deleteOne({ _id: otpDoc._id })
      return res.status(400).json({
        success: false,
        error: "OTP has expired",
      })
    }
    const token = crypto.randomBytes(32).toString("hex")
    otpDoc.token = token
    otpDoc.expiresAt = new Date()
    otpDoc.expiresAt.setMinutes(otpDoc.expiresAt.getMinutes() + 30)
    await otpDoc.save()
    res.status(200).json({
      success: true,
      message: "OTP verified successfully",
      token,
    })
  } catch (error) {
    console.error("Verify OTP error:", error)
    res.status(500).json({
      success: false,
      error: "An error occurred while verifying OTP",
    })
  }
})

// Reset password with token
app.post("/api/reset-password", async (req, res) => {
  try {
    const { email, token, password } = req.body
    if (!email || !token || !password) {
      return res.status(400).json({
        success: false,
        error: "Email, token and password are required",
      })
    }
    const otpDoc = await OTP.findOne({ email, token })
    if (!otpDoc) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired token",
      })
    }
    if (new Date() > otpDoc.expiresAt) {
      await OTP.deleteOne({ _id: otpDoc._id })
      return res.status(400).json({
        success: false,
        error: "Reset token has expired",
      })
    }
    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      })
    }
    const hashedPassword = await bcrypt.hash(password, 10)
    user.password = hashedPassword
    user.updatedAt = new Date()
    await user.save()
    await OTP.deleteOne({ _id: otpDoc._id })
    res.status(200).json({
      success: true,
      message: "Password reset successfully",
    })
  } catch (error) {
    console.error("Reset password error:", error)
    res.status(500).json({
      success: false,
      error: "An error occurred while resetting password",
    })
  }
})

// Login User
app.post("/api/auth/login", async (req, res) => {
  try {
    const { emailOrPhone, password } = req.body
    const user = await User.findOne({
      $or: [{ email: emailOrPhone }, { phone: emailOrPhone }],
    })
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials. Please check your email/phone and password.",
      })
    }
    const isPasswordValid = await bcrypt.compare(password, user.password)
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials. Please check your email/phone and password.",
      })
    }
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET || "your-secret-key", {
      expiresIn: "7d",
    })
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userType: user.userType,
      profileImage: user.profileImage,
      storeName: user.storeName,
      storeAddress: user.storeAddress,
      isVerified: user.isVerified,
      isActive: user.isActive,
      createdAt: user.createdAt,
    }
    res.json({
      success: true,
      message: "Login successful!",
      user: userData,
      token,
    })
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json({
      success: false,
      message: "An error occurred during login. Please try again.",
    })
  }
})

// Get Current User
app.get("/api/auth/me", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password")
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      })
    }
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userType: user.userType,
      profileImage: user.profileImage,
      storeName: user.storeName,
      storeAddress: user.storeAddress,
      businessLicense: user.businessLicense,
      isVerified: user.isVerified,
      isActive: user.isActive,
      sellerRequestStatus: user.sellerRequestStatus,
      createdAt: user.createdAt,
    }
    res.json({
      success: true,
      user: userData,
    })
  } catch (error) {
    console.error("Get user error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to get user data",
    })
  }
})

// Become Seller - Updated to create seller request instead of direct conversion
app.post("/api/auth/become-seller", authenticateToken, async (req, res) => {
  try {
    const { storeName, storeAddress, businessLicense } = req.body
    const user = await User.findById(req.user.id)
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      })
    }
    // Check if user already has a pending or approved request
    const existingRequest = await SellerRequest.findOne({
      userId: user._id,
      status: { $in: ["pending", "approved"] },
    })
    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: `You already have a ${existingRequest.status} seller request.`,
      })
    }
    if (user.userType === "seller") {
      return res.status(400).json({
        success: false,
        message: "You are already a seller.",
      })
    }
    // Create seller request
    const sellerRequest = new SellerRequest({
      userId: user._id,
      userName: user.name,
      userEmail: user.email,
      storeName,
      storeAddress,
      businessLicense,
    })
    await sellerRequest.save()
    // Update user status
    user.sellerRequestStatus = "pending"
    user.updatedAt = new Date()
    await user.save()
    res.json({
      success: true,
      message: "Seller request submitted successfully! Please wait for admin approval.",
      request: {
        id: sellerRequest._id,
        status: sellerRequest.status,
        createdAt: sellerRequest.createdAt,
      },
    })
  } catch (error) {
    console.error("Become seller error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to submit seller request. Please try again.",
    })
  }
})

// =============================================================================
// ADMIN ROUTES
// =============================================================================

// Get Admin Dashboard Stats
app.get("/api/admin/stats", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ userType: { $ne: "admin" } })
    const totalSellers = await User.countDocuments({ userType: "seller" })
    const pendingRequests = await SellerRequest.countDocuments({ status: "pending" })
    const activeSellers = await User.countDocuments({
      userType: "seller",
      isActive: true,
    })
    const totalProducts = await Item.countDocuments({})
    const availableProducts = await Item.countDocuments({ isAvailable: true })
    const hiddenProducts = await Item.countDocuments({ isAvailable: false })
    const totalOrders = await Order.countDocuments({})
    
    const stats = {
      totalUsers,
      totalSellers,
      pendingRequests,
      activeSellers,
      totalProducts,
      availableProducts,
      hiddenProducts,
      totalOrders,
    }
    res.json({
      success: true,
      stats,
    })
  } catch (error) {
    console.error("Get admin stats error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch admin statistics",
    })
  }
})

// Get Seller Requests
app.get("/api/admin/seller-requests", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query
    const query = {}
    if (status) {
      query.status = status
    }
    const requests = await SellerRequest.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate("userId", "name email phone")
      .populate("processedBy", "name email")
    const total = await SellerRequest.countDocuments(query)
    res.json({
      success: true,
      requests,
      totalPages: Math.ceil(total / limit),
      currentPage: Number.parseInt(page),
      totalRequests: total,
    })
  } catch (error) {
    console.error("Get seller requests error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch seller requests",
    })
  }
})

// Approve Seller Request
app.post("/api/admin/seller-requests/:id/approve", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const requestId = req.params.id
    const adminId = req.user.id
    const sellerRequest = await SellerRequest.findById(requestId)
    if (!sellerRequest) {
      return res.status(404).json({
        success: false,
        message: "Seller request not found",
      })
    }
    if (sellerRequest.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "This request has already been processed",
      })
    }
    // Update seller request
    sellerRequest.status = "approved"
    sellerRequest.processedAt = new Date()
    sellerRequest.processedBy = adminId
    await sellerRequest.save()
    // Update user to seller
    const user = await User.findById(sellerRequest.userId)
    if (user) {
      user.userType = "seller"
      user.storeName = sellerRequest.storeName
      user.storeAddress = sellerRequest.storeAddress
      user.businessLicense = sellerRequest.businessLicense
      user.sellerRequestStatus = "approved"
      user.isVerified = true
      user.updatedAt = new Date()
      await user.save()
    }
    res.json({
      success: true,
      message: "Seller request approved successfully",
      request: sellerRequest,
    })
  } catch (error) {
    console.error("Approve seller request error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to approve seller request",
    })
  }
})

// Reject Seller Request
app.post("/api/admin/seller-requests/:id/reject", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const requestId = req.params.id
    const adminId = req.user.id
    const { reason } = req.body
    const sellerRequest = await SellerRequest.findById(requestId)
    if (!sellerRequest) {
      return res.status(404).json({
        success: false,
        message: "Seller request not found",
      })
    }
    if (sellerRequest.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "This request has already been processed",
      })
    }
    // Update seller request
    sellerRequest.status = "rejected"
    sellerRequest.processedAt = new Date()
    sellerRequest.processedBy = adminId
    sellerRequest.rejectionReason = reason
    await sellerRequest.save()
    // Update user status
    const user = await User.findById(sellerRequest.userId)
    if (user) {
      user.sellerRequestStatus = "rejected"
      user.updatedAt = new Date()
      await user.save()
    }
    res.json({
      success: true,
      message: "Seller request rejected successfully",
      request: sellerRequest,
    })
  } catch (error) {
    console.error("Reject seller request error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to reject seller request",
    })
  }
})

// Get All Sellers
app.get("/api/admin/sellers", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status } = req.query
    const query = { userType: "seller" }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { storeName: { $regex: search, $options: "i" } },
      ]
    }
    if (status) {
      query.isActive = status === "active"
    }
    const sellers = await User.find(query)
      .select("-password")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
    const total = await User.countDocuments(query)
    res.json({
      success: true,
      sellers,
      totalPages: Math.ceil(total / limit),
      currentPage: Number.parseInt(page),
      totalSellers: total,
    })
  } catch (error) {
    console.error("Get sellers error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch sellers",
    })
  }
})

// Toggle Seller Status (Activate/Deactivate)
app.patch("/api/admin/sellers/:id/status", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const sellerId = req.params.id
    const { isActive } = req.body
    const seller = await User.findOne({
      _id: sellerId,
      userType: "seller",
    })
    if (!seller) {
      return res.status(404).json({
        success: false,
        message: "Seller not found",
      })
    }
    seller.isActive = isActive
    seller.updatedAt = new Date()
    await seller.save()
    // If deactivating, also deactivate all their items
    if (!isActive) {
      await Item.updateMany({ sellerId: sellerId }, { isAvailable: false, updatedAt: new Date() })
    }
    res.json({
      success: true,
      message: `Seller ${isActive ? "activated" : "deactivated"} successfully`,
      seller: {
        id: seller._id,
        name: seller.name,
        email: seller.email,
        isActive: seller.isActive,
      },
    })
  } catch (error) {
    console.error("Toggle seller status error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to update seller status",
    })
  }
})
app.get("/api/admin-items", async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20, status = "available" } = req.query
    
    // Query to find only admin-added items
    const query = {
      sellerName: "admin", // Items added by admin have sellerName as "Admin"
    }
    
    // By default, only show available items for public API
    // You can change this behavior by modifying the default status
    if (status === "available") {
      query.isAvailable = true
    } else if (status === "hidden") {
      query.isAvailable = false
    } else if (status === "all") {
      // Don't filter by availability - show all admin items
    } else {
      // Default to available items
      query.isAvailable = true
    }
    
    // Filter by category
    if (category) {
      query.category = { $regex: category, $options: "i" }
    }
    
    // Search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
      ]
    }

    const items = await Item.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)

    const total = await Item.countDocuments(query)

    res.json({
      success: true,
      items,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      totalItems: total,
      message: "Admin items retrieved successfully"
    })
  } catch (error) {
    console.error("Get admin items error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch admin items",
    })
  }
})
// Admin: Toggle Item Availability
app.patch("/api/admin/items/:id/status", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const itemId = req.params.id
    const { isAvailable } = req.body
    const item = await Item.findById(itemId)
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      })
    }
    item.isAvailable = !!isAvailable
    item.updatedAt = new Date()
    await item.save()
    res.json({
      success: true,
      message: `Item ${isAvailable ? "activated (visible)" : "deactivated (hidden)"} successfully`,
      item: {
        id: item._id,
        name: item.name,
        isAvailable: item.isAvailable,
      },
    })
  } catch (error) {
    console.error("Admin toggle item status error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to update item status",
    })
  }
})

// Get All Users (for admin)
app.get("/api/admin/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, search, userType } = req.query
    const query = { userType: { $ne: "admin" } }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ]
    }
    if (userType && userType !== "all") {
      query.userType = userType
    }
    const users = await User.find(query)
      .select("-password")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
    const total = await User.countDocuments(query)
    res.json({
      success: true,
      users,
      totalPages: Math.ceil(total / limit),
      currentPage: Number.parseInt(page),
      totalUsers: total,
    })
  } catch (error) {
    console.error("Get users error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
    })
  }
})

// Create Admin User (Run this once to create your first admin)
app.post("/api/create-admin", async (req, res) => {
  try {
    const { name, email, phone, password, secretKey } = req.body
    // Use a secret key to protect this endpoint
    if (secretKey !== "create-admin-secret-2024") {
      return res.status(401).json({
        success: false,
        message: "Invalid secret key",
      })
    }
    // Check if admin already exists
    const existingAdmin = await User.findOne({ userType: "admin" })
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: "Admin user already exists",
      })
    }
    // Check if user with email/phone already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }],
    })
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email or phone number.",
      })
    }
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)
    // Create admin user
    const admin = new User({
      name,
      email,
      phone,
      password: hashedPassword,
      userType: "admin",
      isVerified: true,
    })
    await admin.save()
    res.status(201).json({
      success: true,
      message: "Admin user created successfully!",
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        userType: admin.userType,
      },
    })
  } catch (error) {
    console.error("Create admin error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to create admin user",
    })
  }
})

// Toggle User Status (Activate/Deactivate) - For admin
app.patch("/api/admin/users/:id/status", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id
    const { isActive } = req.body
    // Prevent admin from changing their own status or other admins
    const user = await User.findOne({ _id: userId, userType: { $ne: "admin" } })
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found or you cannot modify admin status",
      })
    }
    user.isActive = isActive
    user.updatedAt = new Date()
    await user.save()
    // If user is a seller, also update their items' isAvailable status
    if (user.userType === "seller") {
      await Item.updateMany({ sellerId: userId }, { isAvailable: !!isActive, updatedAt: new Date() })
    }
    res.json({
      success: true,
      message: `User ${isActive ? "activated" : "deactivated"} successfully`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isActive: user.isActive,
        userType: user.userType,
      },
    })
  } catch (error) {
    console.error("Toggle user status error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to update user status",
    })
  }
})

// =============================================================================
// ITEM/PRODUCT MANAGEMENT APIs
// =============================================================================

// Add Item (Sellers only) - Updated to check seller status
app.post("/api/items", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
    if (user.userType !== "seller" && user.userType !=="admin") {
      return res.status(403).json({
        success: false,
        message: "Only approved sellers can add items",
      })
    }
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your seller account is currently deactivated. Please contact admin.",
      })
    }
    const { name, description, price, category, imageUrl, quantity, unit } = req.body
    const item = new Item({
      name,
      description,
      price,
      category,
      imageUrl,
      quantity,
      unit,
      sellerId: user._id,
      sellerName: user.name,
      storeName: user.storeName || user.name,
    })
    await item.save()
    res.status(201).json({
      success: true,
      message: "Item added successfully!",
      item,
    })
  } catch (error) {
    console.error("Add item error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to add item. Please try again.",
    })
  }
})

// Get All Items - Updated to only show items from active sellers
app.get("/api/items", async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20 } = req.query
    
    // First get active sellers
    const activeSellers = await User.find({
      userType: "seller",
      isActive: true,
    }).select("_id")
    const activeSellerIds = activeSellers.map((seller) => seller._id)
    
    const query = {
      isAvailable: true,
      sellerId: { $in: activeSellerIds },
    }
    
    if (category) {
      query.category = { $regex: category, $options: "i" }
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
      ]
    }
    
    const items = await Item.find(query)
      .select('name description price category imageUrl quantity unit sellerId sellerName storeName discount tax hasVAT isAvailable createdAt updatedAt') // Added discount, tax, hasVAT
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
    
    const total = await Item.countDocuments(query)
    
    res.json({
      success: true,
      items,
      totalPages: Math.ceil(total / limit),
      currentPage: Number.parseInt(page),
      totalItems: total,
    })
  } catch (error) {
    console.error("Get items error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch items",
    })
  }
})

// 2. Update the admin get items endpoint
app.get("/api/admin/items", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 100, category, search } = req.query;
    
    let query = {};
    if (category && category !== 'all') {
      query.category = category;
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const items = await Item.find(query)
      .select('name description price category imageUrl quantity unit sellerId sellerName storeName discount tax hasVAT isAvailable createdAt') // Added discount, tax, hasVAT
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Item.countDocuments(query);

    res.json({
      success: true,
      items,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });

  } catch (error) {
    console.error("Get items error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch items"
    });
  }
});

// 3. Update the admin-items public endpoint
app.get("/api/admin-items", async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20, status = "available" } = req.query
    
    // Query to find only admin-added items
    const query = {
      sellerName: "admin", // Items added by admin have sellerName as "admin"
    }
    
    // By default, only show available items for public API
    if (status === "available") {
      query.isAvailable = true
    } else if (status === "hidden") {
      query.isAvailable = false
    } else if (status === "all") {
      // Don't filter by availability - show all admin items
    } else {
      // Default to available items
      query.isAvailable = true
    }
    
    // Filter by category
    if (category) {
      query.category = { $regex: category, $options: "i" }
    }
    
    // Search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
      ]
    }

    const items = await Item.find(query)
      .select('name description price category imageUrl quantity unit sellerId sellerName storeName discount tax hasVAT isAvailable createdAt') // Added discount, tax, hasVAT
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)

    const total = await Item.countDocuments(query)

    res.json({
      success: true,
      items,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      totalItems: total,
      message: "Admin items retrieved successfully"
    })
  } catch (error) {
    console.error("Get admin items error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch admin items",
    })
  }
})

// 4. Fix the admin add item endpoint to handle discount, tax, VAT properly
app.post("/api/admin/items/json", authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log("JSON Request body:", req.body);

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const { 
      name, 
      description, 
      price, 
      category, 
      quantity, 
      unit, 
      imageUrl,
      discount = 0, 
      tax = 0, 
      hasVAT = false 
    } = req.body;
    
    // Validate required fields
    if (!name || !description || !price || !category || !quantity || !unit) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided",
      });
    }

    console.log("Discount, Tax, VAT values:", { discount, tax, hasVAT });

    // Create item with proper type conversion
    const item = new Item({
      name: name.trim(),
      description: description.trim(),
      price: parseFloat(price),
      category: category.trim(),
      imageUrl: imageUrl || '',
      quantity: parseInt(quantity),
      unit: unit.trim(),
      sellerId: user._id,
      sellerName: user.name,
      storeName: user.storeName || user.name,
      discount: parseFloat(discount) || 0,  // Ensure it's a number
      tax: parseFloat(tax) || 0,           // Ensure it's a number
      hasVAT: Boolean(hasVAT),             // Ensure it's a boolean
      isAvailable: true,
    });

    const savedItem = await item.save();
    console.log("Item saved with discount/tax/VAT:", {
      discount: savedItem.discount,
      tax: savedItem.tax,
      hasVAT: savedItem.hasVAT
    });

    res.status(201).json({
      success: true,
      message: "Product added successfully by admin!",
      item: savedItem,
    });

  } catch (error) {
    console.error("Admin add item error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add product. Please try again.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 5. Update Get Seller Items to include discount, tax, VAT
app.get("/api/items/my-items", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
    if (user.userType !== "seller" && user.userType !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only sellers can view their items",
      })
    }
    
    const items = await Item.find({ sellerId: user._id })
      .select('name description price category imageUrl quantity unit sellerId sellerName storeName discount tax hasVAT isAvailable createdAt updatedAt') // Added discount, tax, hasVAT
      .sort({ createdAt: -1 })
    
    res.json({
      success: true,
      items,
    })
  } catch (error) {
    console.error("Get seller items error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch your items",
    })
  }
})
// Update Item
app.put("/api/items/:id", authenticateToken, async (req, res) => {
  try {
    const item = await Item.findOne({
      _id: req.params.id,
      sellerId: req.user.id,
    })
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found or you are not authorized to update it",
      })
    }
    const updates = req.body
    updates.updatedAt = new Date()
    const updatedItem = await Item.findByIdAndUpdate(req.params.id, updates, { new: true })
    res.json({
      success: true,
      message: "Item updated successfully!",
      item: updatedItem,
    })
  } catch (error) {
    console.error("Update item error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to update item",
    })
  }
})

// Delete Item
app.delete("/api/items/:id", authenticateToken, async (req, res) => {
  try {
    const item = await Item.findOneAndDelete({
      _id: req.params.id,
      sellerId: req.user.id,
    })
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found or you are not authorized to delete it",
      })
    }
    res.json({
      success: true,
      message: "Item deleted successfully!",
    })
  } catch (error) {
    console.error("Delete item error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to delete item",
    })
  }
})

// Get Categories
app.get("/api/categories", async (req, res) => {
  try {
    const categories = await Item.distinct("category")
    res.json({
      success: true,
      categories,
    })
  } catch (error) {
    console.error("Get categories error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
    })
  }
})

// =============================================================================
// ORDER MANAGEMENT APIs
// =============================================================================

// Create order
app.post("/api/orders", authenticateToken, async (req, res) => {
  try {
    const { 
      items, 
      address, 
      paymentMethod, 
      paymentId, 
      razorpayOrderId, 
      subtotal, 
      deliveryFee, 
      taxAmount, 
      totalAmount,
      specialRequests 
    } = req.body;

    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Order items are required",
      });
    }

    if (!address || !address.name || !address.phone || !address.address) {
      return res.status(400).json({
        success: false,
        message: "Delivery address is required",
      });
    }

    if (!paymentMethod || !["cod", "online"].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: "Valid payment method is required",
      });
    }

    // Generate unique order ID
    const orderId = generateOrderId();

    // Set payment status based on payment method
    let paymentStatus = "pending";
    if (paymentMethod === "cod") {
      paymentStatus = "pending"; // COD remains pending until delivery
    } else if (paymentMethod === "online" && paymentId) {
      paymentStatus = "paid";
    }

    // Calculate estimated delivery (7 days from now)
    const estimatedDelivery = new Date();
    estimatedDelivery.setDate(estimatedDelivery.getDate() + 7);

    const order = new Order({
      userId: req.user.id,
      orderId,
      items,
      address,
      paymentMethod,
      paymentStatus,
      paymentId,
      razorpayOrderId,
      subtotal,
      deliveryFee,
      taxAmount,
      totalAmount,
      specialRequests: specialRequests || '', // Added special requests field
      orderStatus: "confirmed",
      estimatedDelivery,
    });

    await order.save();

    // Clear user's cart after successful order
    try {
      await Cart.deleteOne({ userId: req.user.id });
    } catch (cartError) {
      console.error("Failed to clear cart after order:", cartError);
      // Don't fail the order if cart clearing fails
    }

    // Send order confirmation email
    try {
      const user = await User.findById(req.user.id);
      await sendOrderConfirmationEmail(user, order);
    } catch (emailError) {
      console.error("Failed to send order confirmation email:", emailError);
      // Don't fail the order creation if email fails
    }

    res.status(201).json({
      success: true,
      message: "Order placed successfully!",
      order_id: order.orderId,
      order: {
        id: order._id,
        orderId: order.orderId,
        totalAmount: order.totalAmount,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        estimatedDelivery: order.estimatedDelivery,
        specialRequests: order.specialRequests, // Include in response
        createdAt: order.createdAt,
      },
    });
  } catch (error) {
    console.error("Create order error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create order",
    });
  }
});

// Get user orders
app.get("/api/orders", authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const query = {}; // Filter by user ID
    
    if (status) {
      query.orderStatus = status;
    }

    const orders = await Order.find(query)
      .populate("userId", "name email phone")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments(query);

    res.json({
      success: true,
      orders,
      totalPages: Math.ceil(total / limit),
      currentPage: Number.parseInt(page),
      totalOrders: total,
    });
  } catch (error) {
    console.error("Get orders error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
    });
  }
});
// Get single order
app.get("/api/orders/:orderId", authenticateToken, async (req, res) => {
  try {
    const order = await Order.findOne({
      orderId: req.params.orderId,
      userId: req.user.id,
    })
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      })
    }
    res.json({
      success: true,
      order,
    })
  } catch (error) {
    console.error("Get order error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch order",
    })
  }
})

// Cancel order
app.patch("/api/orders/:orderId/cancel", authenticateToken, async (req, res) => {
  try {
    const { reason } = req.body
    const order = await Order.findOne({
      orderId: req.params.orderId,
      userId: req.user.id,
    })
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      })
    }
    // Check if order can be cancelled
    if (!["pending", "confirmed"].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: "Order cannot be cancelled at this stage",
      })
    }
    order.orderStatus = "cancelled"
    order.cancelledAt = new Date()
    order.cancellationReason = reason || "Cancelled by user"
    order.updatedAt = new Date()
    // If payment was made online, mark for refund
    if (order.paymentMethod === "online" && order.paymentStatus === "paid") {
      order.paymentStatus = "refunded"
    }
    await order.save()
    res.json({
      success: true,
      message: "Order cancelled successfully",
      order: {
        orderId: order.orderId,
        orderStatus: order.orderStatus,
        cancelledAt: order.cancelledAt,
      },
    })
  } catch (error) {
    console.error("Cancel order error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to cancel order",
    })
  }
})

// =============================================================================
// RAZORPAY & PAYMENT APIs - UNCOMMENTED
// =============================================================================

// Create Razorpay order
app.post("/api/create-razorpay-order", authenticateToken, async (req, res) => {
  try {
    const { amount, currency = "INR" } = req.body
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid amount is required",
      })
    }
    const options = {
      amount: Math.round(amount), // Amount in paise
      currency,
      receipt: `receipt_${Date.now()}`,
      payment_capture: 1,
    }
    const order = await razorpay.orders.create(options)
    res.json({
      success: true,
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
    })
  } catch (error) {
    console.error("Create Razorpay order error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to create payment order",
    })
  }
})

// Verify Razorpay payment
app.post("/api/verify-razorpay-payment", authenticateToken, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body
    const sign = razorpay_order_id + "|" + razorpay_payment_id
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest("hex")
    if (razorpay_signature === expectedSign) {
      res.json({
        success: true,
        message: "Payment verified successfully",
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
      })
    } else {
      res.status(400).json({
        success: false,
        message: "Invalid payment signature",
      })
    }
  } catch (error) {
    console.error("Verify payment error:", error)
    res.status(500).json({
      success: false,
      message: "Payment verification failed",
    })
  }
})
// =============================================================================
// GOOGLE & FACEBOOK OAUTH ROUTES
// =============================================================================

// Google OAuth Login
app.post("/api/auth/google", async (req, res) => {
  try {
    const { idToken } = req.body
    if (!idToken) return res.status(400).json({ success: false, message: "No idToken provided" })

    // Verify token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    })
    const payload = ticket.getPayload()
    const { email, name, picture } = payload

    // Find or create user
    let user = await User.findOne({ email })
    if (!user) {
      user = new User({
        name,
        email,
        phone: "", // You may want to ask for phone later
        password: "", // Not needed for OAuth
        userType: "buyer",
        isVerified: true,
        profileImage: picture,
      })
      await user.save()
    }

    // Generate JWT
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET || "your-secret-key", {
      expiresIn: "7d",
    })

    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userType: user.userType,
      profileImage: user.profileImage,
      isVerified: user.isVerified,
      isActive: user.isActive,
      createdAt: user.createdAt,
    }

    res.json({
      success: true,
      message: "Google login successful!",
      user: userData,
      token,
    })
  } catch (error) {
    console.error("Google OAuth error:", error)
    res.status(500).json({ success: false, message: "Google login failed" })
  }
})

// Facebook OAuth Login
app.post("/api/auth/facebook", async (req, res) => {
  try {
    const { accessToken } = req.body
    if (!accessToken) return res.status(400).json({ success: false, message: "No accessToken provided" })

    // Verify token and get user info
    const fbRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${accessToken}`,
    )
    const fbData = await fbRes.json()
    if (!fbData.email) {
      return res.status(400).json({ success: false, message: "Facebook account has no email" })
    }

    // Find or create user
    let user = await User.findOne({ email: fbData.email })
    if (!user) {
      user = new User({
        name: fbData.name,
        email: fbData.email,
        phone: "", // You may want to ask for phone later
        password: "", // Not needed for OAuth
        userType: "buyer",
        isVerified: true,
        profileImage: fbData.picture?.data?.url,
      })
      await user.save()
    }

    // Generate JWT
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET || "your-secret-key", {
      expiresIn: "7d",
    })

    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userType: user.userType,
      profileImage: user.profileImage,
      isVerified: user.isVerified,
      isActive: user.isActive,
      createdAt: user.createdAt,
    }

    res.json({
      success: true,
      message: "Facebook login successful!",
      user: userData,
      token,
    })
  } catch (error) {
    console.error("Facebook OAuth error:", error)
    res.status(500).json({ success: false, message: "Facebook login failed" })
  }
})

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" })
})

// Get all orders for admin
app.get("/api/admin/orders", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, status, search } = req.query

    const query = {}

    // Filter by status if provided
    if (status && status !== "all") {
      query.orderStatus = status
    }

    // Search functionality
    if (search) {
      query.$or = [
        { orderId: { $regex: search, $options: "i" } },
        { "userId.name": { $regex: search, $options: "i" } },
        { "userId.email": { $regex: search, $options: "i" } },
      ]
    }

    const orders = await Order.find(query)
      .populate("userId", "name email phone")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)

    const total = await Order.countDocuments(query)

    res.json({
      success: true,
      data: {
        orders,
        totalPages: Math.ceil(total / limit),
        currentPage: Number.parseInt(page),
        totalOrders: total,
      },
    })
  } catch (error) {
    console.error("Get admin orders error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
    })
  }
})

// Get all users for admin
app.get("/api/admin/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 100, userType, search } = req.query

    const query = {}

    // Filter by user type if provided
    if (userType && userType !== "all") {
      query.userType = userType
    }

    // Search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ]
    }

    const users = await User.find(query)
      .select("-password") // Exclude password field
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)

    const total = await User.countDocuments(query)

    res.json({
      success: true,
      users,
      totalPages: Math.ceil(total / limit),
      currentPage: Number.parseInt(page),
      totalUsers: total,
    })
  } catch (error) {
    console.error("Get admin users error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
    })
  }
})

app.post("/api/items", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)

    // Allow both sellers and admins to add items
    if (!user || (user.userType !== "seller" && user.userType !== "admin")) {
      return res.status(403).json({
        success: false,
        message: "Only approved sellers and admins can add items",
      })
    }

    // For sellers, check if they are active
    if (user.userType === "seller" && !user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your seller account is currently deactivated. Please contact admin.",
      })
    }

    const { name, description, price, category, imageUrl, quantity, unit } = req.body

    const item = new Item({
      name,
      description,
      price,
      category,
      imageUrl,
      quantity,
      unit,
      sellerId: user._id,
      sellerName: user.name,
      storeName: user.storeName || user.name,
    })

    await item.save()

    res.status(201).json({
      success: true,
      message: "Item added successfully!",
      item,
    })
  } catch (error) {
    console.error("Add item error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to add item. Please try again.",
    })
  }
})

app.patch("/api/admin/items/:itemId/status", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { itemId } = req.params
    const { isAvailable } = req.body

    const item = await Item.findByIdAndUpdate(itemId, { isAvailable }, { new: true })

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      })
    }

    res.json({
      success: true,
      message: `Item ${isAvailable ? "made available" : "hidden"} successfully`,
      item,
    })
  } catch (error) {
    console.error("Toggle item status error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to update item status",
    })
  }
})

app.get("/api/admin/orders/:orderId/invoice/download", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({ orderId }).populate("userId", "name email phone");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Generate PDF
    const pdfBuffer = await generateInvoicePDF(order);
    
    // Set headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice_${orderId}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Send PDF buffer
    res.send(pdfBuffer);

  } catch (error) {
    console.error("Download invoice error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate invoice",
    });
  }
});

// Get Invoice Data (for mobile app PDF generation)
app.get("/api/admin/orders/:orderId/invoice/data", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({ orderId }).populate("userId", "name email phone");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Return structured invoice data
    const invoiceData = {
      // Company Details
      company: {
        name: "Your Company Name",
        address: "123 Business Street",
        city: "Business City, State 12345",
        phone: "+1 (555) 123-4567",
        email: "info@yourcompany.com",
        website: "www.yourcompany.com"
      },
      
      // Invoice Details
      invoice: {
        number: orderId,
        date: order.createdAt,
        dueDate: order.estimatedDelivery,
      },
      
      // Customer Details
      customer: {
        name: order.userId.name,
        email: order.userId.email,
        phone: order.userId.phone,
        address: {
          name: order.address.name,
          phone: order.address.phone,
          address: order.address.address,
          city: order.address.city,
          state: order.address.state,
          pincode: order.address.pincode,
        }
      },
      
      // Order Details
      order: {
        id: order._id,
        orderId: order.orderId,
        items: order.items,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        taxAmount: order.taxAmount,
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        createdAt: order.createdAt,
        estimatedDelivery: order.estimatedDelivery,
      }
    };

    res.json({
      success: true,
      invoiceData,
    });

  } catch (error) {
    console.error("Get invoice data error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch invoice data",
    });
  }
});
app.get("/api/admin/users/:userId", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select("-password");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get user's order statistics
    const totalOrders = await Order.countDocuments({ userId });
    const completedOrders = await Order.countDocuments({ 
      userId, 
      orderStatus: "delivered" 
    });
    
    const totalSpentResult = await Order.aggregate([
      { $match: { userId: mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } }
    ]);
    
    const totalSpent = totalSpentResult.length > 0 ? totalSpentResult[0].total : 0;

    const userDetails = {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userType: user.userType,
      isActive: user.isActive,
      isVerified: user.isVerified,
      createdAt: user.createdAt,
      totalOrders,
      completedOrders,
      totalSpent,
    };

    res.json({
      success: true,
      user: userDetails,
    });

  } catch (error) {
    console.error("Get user details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user details",
    });
  }
});

// Get User Order History (for View Customer feature)
app.get("/api/admin/users/:userId/orders", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const orders = await Order.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const totalOrders = await Order.countDocuments({ userId });

    res.json({
      success: true,
      orders,
      totalPages: Math.ceil(totalOrders / limit),
      currentPage: parseInt(page),
      totalOrders,
    });

  } catch (error) {
    console.error("Get user orders error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user orders",
    });
  }
});

// Admin: Add Product (Admin can add products without seller ID)
// Create uploads directory if it doesn't exist
const uploadDir = 'uploads/products';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir)
  },
  filename: function (req, file, cb) {
    // Create unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const fileName = 'product-' + uniqueSuffix + path.extname(file.originalname)
    cb(null, fileName)
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Serve static files for uploaded images
app.use('/uploads', express.static('uploads'));

// Updated API endpoint to handle both JSON and multipart data
app.post("/api/admin/items", authenticateToken, requireAdmin, (req, res, next) => {
  // Check content type to decide how to handle the request
  const contentType = req.get('Content-Type');
  
  if (contentType && contentType.includes('multipart/form-data')) {
    // Handle file upload
    upload.single('image')(req, res, next);
  } else {
    // Handle JSON data (no file upload)
    next();
  }
}, async (req, res) => {
  try {
    console.log("Request body:", req.body);
    console.log("Uploaded file:", req.file);
    console.log("Content-Type:", req.get('Content-Type'));

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const { 
      name, 
      description, 
      price, 
      category, 
      quantity, 
      unit, 
      imageUrl,  // This will come from JSON requests
      discount = 0, 
      tax = 0, 
      hasVAT = false 
    } = req.body;
    
    // Validate required fields
    if (!name || !description || !price || !category || !quantity || !unit) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided",
      });
    }

    // Determine final image URL
    let finalImageUrl = '';
    
    if (req.file) {
      // File was uploaded - use the uploaded file URL
      finalImageUrl = `${req.protocol}://${req.get('host')}/uploads/products/${req.file.filename}`;
      console.log("Using uploaded file URL:", finalImageUrl);
    } else if (imageUrl) {
      // No file uploaded but imageUrl provided in JSON - use the provided URL
      finalImageUrl = imageUrl;
      console.log("Using provided imageUrl:", finalImageUrl);
    }

    console.log("Final image URL to save:", finalImageUrl);

    // Create item with the determined image URL
    const item = new Item({
      name: name.trim(),
      description: description.trim(),
      price: parseFloat(price),
      category: category.trim(),
      imageUrl: finalImageUrl, // This will be either uploaded file URL or provided URL
      quantity: parseInt(quantity),
      unit: unit.trim(),
      sellerId: user._id,
      sellerName: user.name,
      storeName: user.storeName || user.name,
      discount: parseFloat(discount),
      tax: parseFloat(tax),
      hasVAT: hasVAT === 'true' || hasVAT === true,
      isAvailable: true,
    });

    const savedItem = await item.save();
    console.log("Item saved with imageUrl:", savedItem.imageUrl);

    res.status(201).json({
      success: true,
      message: "Product added successfully by admin!",
      item: savedItem,
    });

  } catch (error) {
    console.error("Admin add item error:", error);
    console.error("Error stack:", error.stack);
    
    // More specific error handling
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(e => e.message).join(', ');
      return res.status(400).json({
        success: false,
        message: `Validation error: ${validationErrors}`,
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Product with this name already exists",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to add product. Please try again.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Alternative approach: Create separate endpoints for different upload methods
// This might be cleaner if you want to handle them differently

// Endpoint for JSON requests (predefined images, custom URLs)
app.post("/api/admin/items/json", authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log("JSON Request body:", req.body);

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const { 
      name, 
      description, 
      price, 
      category, 
      quantity, 
      unit, 
      imageUrl,
      discount = 0, 
      tax = 0, 
      hasVAT = false 
    } = req.body;
    
    // Validate required fields
    if (!name || !description || !price || !category || !quantity || !unit) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided",
      });
    }

    console.log("Image URL from request:", imageUrl);

    // Create item
    const item = new Item({
      name: name.trim(),
      description: description.trim(),
      price: parseFloat(price),
      category: category.trim(),
      imageUrl: imageUrl || '', // Use the provided imageUrl
      quantity: parseInt(quantity),
      unit: unit.trim(),
      sellerId: user._id,
      sellerName: user.name,
      storeName: user.storeName || user.name,
      discount: parseFloat(discount),
      tax: parseFloat(tax),
      hasVAT: hasVAT === 'true' || hasVAT === true,
      isAvailable: true,
    });

    const savedItem = await item.save();
    console.log("Item saved with imageUrl:", savedItem.imageUrl);

    res.status(201).json({
      success: true,
      message: "Product added successfully by admin!",
      item: savedItem,
    });

  } catch (error) {
    console.error("Admin add item error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add product. Please try again.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Endpoint for file uploads
app.post("/api/admin/items/upload", authenticateToken, requireAdmin, upload.single('image'), async (req, res) => {
  try {
    console.log("Upload Request body:", req.body);
    console.log("Uploaded file:", req.file);

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const { name, description, price, category, quantity, unit, discount = 0, tax = 0, hasVAT = false } = req.body;
    
    // Validate required fields
    if (!name || !description || !price || !category || !quantity || !unit) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided",
      });
    }

    // Generate image URL from uploaded file
    let imageUrl = '';
    if (req.file) {
      imageUrl = `${req.protocol}://${req.get('host')}/uploads/products/${req.file.filename}`;
    }

    console.log("Generated image URL from upload:", imageUrl);

    // Create item
    const item = new Item({
      name: name.trim(),
      description: description.trim(),
      price: parseFloat(price),
      category: category.trim(),
      imageUrl: imageUrl,
      quantity: parseInt(quantity),
      unit: unit.trim(),
      sellerId: user._id,
      sellerName: user.name,
      storeName: user.storeName || user.name,
      discount: parseFloat(discount),
      tax: parseFloat(tax),
      hasVAT: hasVAT === 'true' || hasVAT === true,
      isAvailable: true,
    });

    const savedItem = await item.save();
    console.log("Item saved with imageUrl:", savedItem.imageUrl);

    res.status(201).json({
      success: true,
      message: "Product added successfully by admin!",
      item: savedItem,
    });

  } catch (error) {
    console.error("Admin add item upload error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add product. Please try again.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Keep your existing get items endpoint unchanged
app.get("/api/admin/items", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 100, category, search } = req.query;
    
    let query = {};
    if (category && category !== 'all') {
      query.category = category;
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const items = await Item.find(query)
      .select('name description price category imageUrl quantity unit sellerId sellerName isAvailable createdAt')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Item.countDocuments(query);

    res.json({
      success: true,
      items,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });

  } catch (error) {
    console.error("Get items error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch items"
    });
  }
});
// Admin: Update Product
app.put("/api/admin/items/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const itemId = req.params.id
    const updates = req.body
    
    // Remove fields that shouldn't be updated
    delete updates.sellerId
    delete updates.sellerName
    delete updates.storeName
    
    const updatedItem = await Item.findByIdAndUpdate(
      itemId,
      { ...updates, updatedAt: new Date() },
      { new: true }
    )

    if (!updatedItem) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      })
    }

    res.json({
      success: true,
      message: "Product updated successfully!",
      item: updatedItem,
    })
  } catch (error) {
    console.error("Admin update item error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to update product",
    })
  }
})

// Admin: Delete Product
app.delete("/api/admin/items/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const itemId = req.params.id
    
    const deletedItem = await Item.findByIdAndDelete(itemId)

    if (!deletedItem) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      })
    }

    res.json({
      success: true,
      message: "Product deleted successfully!",
    })
  } catch (error) {
    console.error("Admin delete item error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to delete product",
    })
  }
})

// Admin: Get All Products (including hidden ones)

// Fetch admin products with discount > 0 (public, no auth required)
app.get("/api/admin-products/with-discount", async (req, res) => {
  try {
    const products = await Item.find({
      discount: { $gt: 0 },
      sellerName: "admin", // Use lowercase "admin" to match your database
      isAvailable: true,
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      count: products.length,
      products,
    });
  } catch (error) {
    console.error("Fetch admin discounted products error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch admin discounted products",
    });
  }
});
async function generateInvoicePDF(order) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(buffers);
      resolve(pdfBuffer);
    });
    doc.on('error', reject);

    try {
      // Header
      doc.fillColor('#2563eb')
         .fontSize(28)
         .text('INVOICE', 50, 50);

      // Company Info
      doc.fillColor('#000000')
         .fontSize(12)
         .text('Your Company Name', 400, 50)
         .text('123 Business Street', 400, 65)
         .text('Business City, State 12345', 400, 80)
         .text('Phone: +1 (555) 123-4567', 400, 95)
         .text('Email: info@yourcompany.com', 400, 110);

      // Invoice Details
      doc.fontSize(10)
         .fillColor('#666666')
         .text(`Invoice #: ${order.orderId}`, 50, 150)
         .text(`Date: ${new Date(order.createdAt).toLocaleDateString()}`, 50, 165)
         .text(`Due Date: ${new Date(order.estimatedDelivery).toLocaleDateString()}`, 50, 180)
         .text(`Payment Status: ${order.paymentStatus.toUpperCase()}`, 50, 195);

      // Customer Info
      doc.fontSize(12)
         .fillColor('#000000')
         .text('Bill To:', 50, 230)
         .fontSize(10)
         .text(order.address.name, 50, 250)
         .text(order.address.phone, 50, 265)
         .text(order.address.address, 50, 280)
         .text(`${order.address.city}, ${order.address.state} ${order.address.pincode}`, 50, 295);

      // Table Header
      const tableTop = 350;
      doc.fontSize(10)
         .fillColor('#000000');

      // Draw table header background
      doc.rect(50, tableTop, 500, 25)
         .fillColor('#f3f4f6')
         .fill();

      // Table headers
      doc.fillColor('#000000')
         .text('Item', 60, tableTop + 8)
         .text('Qty', 300, tableTop + 8)
         .text('Price', 350, tableTop + 8)
         .text('Amount', 450, tableTop + 8);

      // Table Items
      let yPosition = tableTop + 35;
      order.items.forEach((item, index) => {
        const amount = item.price * item.quantity;
        
        doc.text(item.name, 60, yPosition)
           .text(item.quantity.toString(), 300, yPosition)
           .text(`$${item.price.toFixed(2)}`, 350, yPosition)
           .text(`$${amount.toFixed(2)}`, 450, yPosition);
        
        yPosition += 20;
      });

      // Totals
      yPosition += 20;
      doc.text('Subtotal:', 400, yPosition)
         .text(`$${order.subtotal.toFixed(2)}`, 450, yPosition);

      yPosition += 15;
      doc.text('Delivery Fee:', 400, yPosition)
         .text(`$${order.deliveryFee.toFixed(2)}`, 450, yPosition);

      yPosition += 15;
      doc.text('Tax:', 400, yPosition)
         .text(`$${order.taxAmount.toFixed(2)}`, 450, yPosition);

      yPosition += 20;
      doc.fontSize(12)
         .fillColor('#2563eb')
         .text('Total:', 400, yPosition)
         .text(`$${order.totalAmount.toFixed(2)}`, 450, yPosition);

      // Footer
      doc.fontSize(8)
         .fillColor('#666666')
         .text('Thank you for your business!', 50, yPosition + 60)
         .text('For any questions regarding this invoice, please contact us.', 50, yPosition + 75);

      doc.end();

    } catch (error) {
      reject(error);
    }
  });
}

const PORT = process.env.PORT || 3000
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`)
  console.log("\n=== ADMIN SETUP ===")
  console.log("To create your first admin user, make a POST request to:")
  console.log(`http://your-server:${PORT}/api/create-admin`)
  console.log(
    'With body: { "name": "Admin Name", "email": "admin@example.com", "phone": "1234567890", "password": "adminpass", "secretKey": "create-admin-secret-2024" }',
  )
  console.log("==================\n")
  console.log("\n=== ENVIRONMENT VARIABLES NEEDED ===")
  console.log("JWT_SECRET=your_jwt_secret")
  console.log("EMAIL_USER=your_email@gmail.com")
  console.log("EMAIL_PASSWORD=your_app_password")
  console.log("MONGODB_URI=your_mongodb_connection_string")
  console.log("RAZORPAY_KEY_ID=your_razorpay_key_id")
  console.log("RAZORPAY_KEY_SECRET=your_razorpay_key_secret")
  console.log("GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com")
  console.log("=====================================\n")
})

import bcrypt from "bcrypt";
import { StatusCodes } from "http-status-codes";
import User from "../models/User.js";
import jwt from "jsonwebtoken";
import generateToken from "../utils/generateToken.js";

export const registerUser = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password } = req.body;

    // 1. Validate required fields and types
    const fields = { firstName, lastName, email, phone, password };

    if (
      Object.values(fields).some(
        (value) => typeof value !== "string" || !value.trim(),
      )
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "All fields are required and must be valid strings",
      });
    }

    // 2. Normalize input
    const normalizedEmail = email.trim().toLowerCase();

    // 3. Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(normalizedEmail)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    // 4. Validate password length
    if (password.length < 4) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Password must contain at least 4 characters",
      });
    }

    // 5. Check whether email already exists
    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(StatusCodes.CONFLICT).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    // 6. Hash the password
    const hashedPassword = await bcrypt.hash(password, 12);

    // 7. Create customer account
    const user = await User.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: normalizedEmail,
      phone: phone.trim(),
      password: hashedPassword,
      role: "customer",
    });

    // 8. Return safe user information
    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Account registered successfully",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);

    // Handle duplicate email caused by concurrent requests
    if (error.code === 11000) {
      return res.status(StatusCodes.CONFLICT).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    if (error.name === "ValidationError") {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid registration information",
      });
    }

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Something went wrong during registration",
    });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    // 1. Validate the submitted credentials
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // 2. Normalize email
    const normalizedEmail = email.trim().toLowerCase();

    // 3. Find user and explicitly include password hash
    const user = await User.findOne({
      email: normalizedEmail,
    }).select("+password");

    // 4. Use the same error for unknown emails and wrong passwords
    if (!user) {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // 5. Compare submitted password with stored hash
    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // 6. Check that the account is active
    if (!user.isActive) {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message: "This account is currently unavailable",
      });
    }

    // 7. Generate authentication token
    const token = generateToken(user);

    // 8. Return authentication information
    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Something went wrong during login",
    });
  }
};

export const getCurrentUser = async (req, res) => {
  try {
    const user = req.user;

    return res.status(StatusCodes.OK).json({
      success: true,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error("Get profile error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to retrieve user profile",
    });
  }
};
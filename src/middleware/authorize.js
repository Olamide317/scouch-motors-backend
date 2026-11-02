import { StatusCodes } from "http-status-codes";

export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    // Authentication middleware must run first
    if (!req.user) {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Check the user's current role
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message: "You do not have permission to perform this action",
      });
    }

    next();
  };
};
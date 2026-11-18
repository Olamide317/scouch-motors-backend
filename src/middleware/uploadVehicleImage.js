import multer from "multer";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_IMAGE_SIZE,
    files: 1,
    fields: 0,
  },

  fileFilter(req, file, callback) {
    if (!allowedTypes.has(file.mimetype)) {
      return callback(
        new Error(
          "Only JPEG, PNG, and WebP images are allowed."
        )
      );
    }

    callback(null, true);
  },
}).single("image");

export function receiveVehicleImage(req, res, next) {
  upload(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (
      error instanceof multer.MulterError &&
      error.code === "LIMIT_FILE_SIZE"
    ) {
      return res.status(413).json({
        success: false,
        message: "Image must not exceed 5 MB.",
      });
    }

    return res.status(400).json({
      success: false,
      message:
        error.message || "Invalid image upload.",
    });
  });
}
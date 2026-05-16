package apperrors

import "github.com/gofiber/fiber/v2"

func BadRequest(msg string) error {
	return fiber.NewError(fiber.StatusBadRequest, msg)
}

func Unauthorized(msg string) error {
	return fiber.NewError(fiber.StatusUnauthorized, msg)
}

func Forbidden(msg string) error {
	return fiber.NewError(fiber.StatusForbidden, msg)
}

func NotFound(msg string) error {
	return fiber.NewError(fiber.StatusNotFound, msg)
}

func Conflict(msg string) error {
	return fiber.NewError(fiber.StatusConflict, msg)
}

func Internal(msg string) error {
	return fiber.NewError(fiber.StatusInternalServerError, msg)
}

package v1

import (
	"math"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	maxBoardPositions  = 64
	maxBoardNameLength = 128
)

// validateBoardPositions checks a memo's per-board card positions. Positions are
// sort keys chosen by the client's drag and drop, so they must be finite numbers.
func validateBoardPositions(positions map[string]float64) (map[string]float64, error) {
	if len(positions) > maxBoardPositions {
		return nil, status.Errorf(codes.InvalidArgument, "too many board positions (max %d)", maxBoardPositions)
	}
	if len(positions) == 0 {
		return nil, nil
	}
	validated := make(map[string]float64, len(positions))
	for board, position := range positions {
		if board == "" || len(board) > maxBoardNameLength {
			return nil, status.Errorf(codes.InvalidArgument, "invalid board name")
		}
		if math.IsNaN(position) || math.IsInf(position, 0) {
			return nil, status.Errorf(codes.InvalidArgument, "board position must be a finite number")
		}
		validated[board] = position
	}
	return validated, nil
}

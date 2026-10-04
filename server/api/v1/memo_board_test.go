package v1

import (
	"math"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateBoardPositions(t *testing.T) {
	t.Run("accepts finite positions and copies them", func(t *testing.T) {
		in := map[string]float64{"work": 1.5, "home": -2}
		out, err := validateBoardPositions(in)
		require.NoError(t, err)
		require.Equal(t, in, out)
	})
	t.Run("empty clears positions", func(t *testing.T) {
		out, err := validateBoardPositions(map[string]float64{})
		require.NoError(t, err)
		require.Nil(t, out)
	})
	t.Run("rejects NaN and infinity", func(t *testing.T) {
		_, err := validateBoardPositions(map[string]float64{"work": math.NaN()})
		require.Error(t, err)
		_, err = validateBoardPositions(map[string]float64{"work": math.Inf(1)})
		require.Error(t, err)
	})
	t.Run("rejects blank or oversized board names", func(t *testing.T) {
		_, err := validateBoardPositions(map[string]float64{"": 1})
		require.Error(t, err)
		_, err = validateBoardPositions(map[string]float64{strings.Repeat("a", maxBoardNameLength+1): 1})
		require.Error(t, err)
	})
	t.Run("rejects too many boards", func(t *testing.T) {
		many := map[string]float64{}
		for i := 0; i <= maxBoardPositions; i++ {
			many[strings.Repeat("b", i+1)] = 1
		}
		_, err := validateBoardPositions(many)
		require.Error(t, err)
	})
}

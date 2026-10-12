package test

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
)

func TestMemoBoardFields(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "board-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	due := time.Date(2030, 1, 2, 3, 4, 5, 0, time.UTC)
	memo, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{Memo: &apiv1.Memo{
		Content:        "ship it #board/work/todo",
		Visibility:     apiv1.Visibility_PRIVATE,
		DueTime:        timestamppb.New(due),
		BoardPositions: map[string]float64{"work": 1},
	}})
	require.NoError(t, err)
	require.True(t, memo.DueTime.AsTime().Equal(due))
	require.Equal(t, map[string]float64{"work": 1}, memo.BoardPositions)
	require.Contains(t, memo.Tags, "board/work/todo")

	t.Run("positions update independently per board and survive a content edit", func(t *testing.T) {
		updated, err := ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: memo.Name, BoardPositions: map[string]float64{"work": 2.5, "home": -1}},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"board_positions"}},
		})
		require.NoError(t, err)
		require.Equal(t, map[string]float64{"work": 2.5, "home": -1}, updated.BoardPositions)

		edited, err := ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: memo.Name, Content: "ship it #board/work/doing"},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
		})
		require.NoError(t, err)
		require.Contains(t, edited.Tags, "board/work/doing")
		require.Equal(t, map[string]float64{"work": 2.5, "home": -1}, edited.BoardPositions)
		require.True(t, edited.DueTime.AsTime().Equal(due), "a content edit must not clear the due date")
	})

	t.Run("due date can be changed and cleared", func(t *testing.T) {
		next := due.Add(48 * time.Hour)
		updated, err := ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: memo.Name, DueTime: timestamppb.New(next)},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"due_time"}},
		})
		require.NoError(t, err)
		require.True(t, updated.DueTime.AsTime().Equal(next))

		cleared, err := ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: memo.Name},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"due_time"}},
		})
		require.NoError(t, err)
		require.Nil(t, cleared.DueTime)
		require.Equal(t, map[string]float64{"work": 2.5, "home": -1}, cleared.BoardPositions)
	})

	t.Run("rejects a non-finite position", func(t *testing.T) {
		_, err := ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: memo.Name, BoardPositions: map[string]float64{"work": math.NaN()}},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"board_positions"}},
		})
		require.Equal(t, codes.InvalidArgument, status.Code(err))
	})

	t.Run("another user cannot move my card", func(t *testing.T) {
		other, err := ts.CreateRegularUser(ctx, "board-other")
		require.NoError(t, err)
		_, err = ts.Service.UpdateMemo(ts.CreateUserContext(ctx, other.ID), &apiv1.UpdateMemoRequest{
			Memo:       &apiv1.Memo{Name: memo.Name, BoardPositions: map[string]float64{"work": 9}},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"board_positions"}},
		})
		require.Error(t, err)
	})
}

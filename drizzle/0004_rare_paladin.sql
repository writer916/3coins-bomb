ALTER TABLE "group_round_attempts" DROP CONSTRAINT "group_round_attempts_state_check";--> statement-breakpoint
ALTER TABLE "group_round_attempts" ADD CONSTRAINT "group_round_attempts_state_check" CHECK ((
        "group_round_attempts"."status" = 'active'
        and "group_round_attempts"."ended_at" is null
        and "group_round_attempts"."terminal_request_id" is null
        and "group_round_attempts"."captured_coins" = 0
      ) or (
        "group_round_attempts"."status" = 'bombed'
        and "group_round_attempts"."ended_at" is not null
        and "group_round_attempts"."terminal_request_id" is not null
        and "group_round_attempts"."captured_coins" between 0 and 2
        and "group_round_attempts"."opened_bag_count" between 1 and 8
      ) or (
        "group_round_attempts"."status" = 'cashed_out'
        and "group_round_attempts"."ended_at" is not null
        and "group_round_attempts"."terminal_request_id" is not null
        and "group_round_attempts"."captured_coins" in (1, 2)
        and "group_round_attempts"."opened_bag_count" between 1 and 8
      ) or (
        "group_round_attempts"."status" = 'cleared'
        and "group_round_attempts"."ended_at" is not null
        and "group_round_attempts"."terminal_request_id" is not null
        and "group_round_attempts"."captured_coins" = 3
        and "group_round_attempts"."opened_bag_count" between 1 and 8
      ) or (
        "group_round_attempts"."status" = 'interrupted'
        and "group_round_attempts"."ended_at" is not null
        and "group_round_attempts"."terminal_request_id" is not null
        and "group_round_attempts"."captured_coins" = 0
      ));
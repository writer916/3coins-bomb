CREATE TABLE "duel_round_opens" (
	"match_id" uuid NOT NULL,
	"round_number" smallint NOT NULL,
	"explorer_role" text NOT NULL,
	"placement_role" text NOT NULL,
	"open_order" smallint NOT NULL,
	"bag_number" smallint NOT NULL,
	"request_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duel_round_opens_match_explorer_round_order_pk" PRIMARY KEY("match_id","explorer_role","round_number","open_order"),
	CONSTRAINT "duel_round_opens_match_explorer_round_bag_unique" UNIQUE("match_id","explorer_role","round_number","bag_number"),
	CONSTRAINT "duel_round_opens_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "duel_round_opens_round_number_check" CHECK ("duel_round_opens"."round_number" between 1 and 20),
	CONSTRAINT "duel_round_opens_roles_check" CHECK ("duel_round_opens"."explorer_role" in ('A', 'B') and "duel_round_opens"."placement_role" in ('A', 'B') and "duel_round_opens"."explorer_role" <> "duel_round_opens"."placement_role"),
	CONSTRAINT "duel_round_opens_open_order_check" CHECK ("duel_round_opens"."open_order" >= 1),
	CONSTRAINT "duel_round_opens_bag_number_check" CHECK ("duel_round_opens"."bag_number" between 1 and 8)
);
--> statement-breakpoint
CREATE TABLE "duel_round_placements" (
	"match_id" uuid NOT NULL,
	"participant_role" text NOT NULL,
	"round_number" smallint NOT NULL,
	"bag_count" smallint NOT NULL,
	"bomb_bag_number" smallint NOT NULL,
	"coin_bag_numbers" smallint[] NOT NULL,
	"locked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duel_round_placements_match_role_round_pk" PRIMARY KEY("match_id","participant_role","round_number"),
	CONSTRAINT "duel_round_placements_participant_role_check" CHECK ("duel_round_placements"."participant_role" in ('A', 'B')),
	CONSTRAINT "duel_round_placements_round_number_check" CHECK ("duel_round_placements"."round_number" between 1 and 20),
	CONSTRAINT "duel_round_placements_bag_count_check" CHECK ("duel_round_placements"."bag_count" between 3 and 8),
	CONSTRAINT "duel_round_placements_bomb_bag_number_check" CHECK ("duel_round_placements"."bomb_bag_number" between 1 and "duel_round_placements"."bag_count"),
	CONSTRAINT "duel_round_placements_coin_count_check" CHECK (array_ndims("duel_round_placements"."coin_bag_numbers") = 1
        and cardinality("duel_round_placements"."coin_bag_numbers") = 3
        and array_lower("duel_round_placements"."coin_bag_numbers", 1) = 1
        and array_upper("duel_round_placements"."coin_bag_numbers", 1) = 3
        and array_position("duel_round_placements"."coin_bag_numbers", null) is null),
	CONSTRAINT "duel_round_placements_coin_bag_numbers_check" CHECK ((
        ("duel_round_placements"."coin_bag_numbers")[1] between 1 and "duel_round_placements"."bag_count"
        and ("duel_round_placements"."coin_bag_numbers")[2] between 1 and "duel_round_placements"."bag_count"
        and ("duel_round_placements"."coin_bag_numbers")[3] between 1 and "duel_round_placements"."bag_count"
        and ("duel_round_placements"."coin_bag_numbers")[1] <> "duel_round_placements"."bomb_bag_number"
        and ("duel_round_placements"."coin_bag_numbers")[2] <> "duel_round_placements"."bomb_bag_number"
        and ("duel_round_placements"."coin_bag_numbers")[3] <> "duel_round_placements"."bomb_bag_number"
        and ("duel_round_placements"."coin_bag_numbers")[1] <= ("duel_round_placements"."coin_bag_numbers")[2]
        and ("duel_round_placements"."coin_bag_numbers")[2] <= ("duel_round_placements"."coin_bag_numbers")[3]
      ))
);
--> statement-breakpoint
CREATE TABLE "duel_round_results" (
	"match_id" uuid NOT NULL,
	"round_number" smallint NOT NULL,
	"explorer_role" text NOT NULL,
	"placement_role" text NOT NULL,
	"end_reason" text NOT NULL,
	"terminal_open_order" smallint,
	"captured_coins" smallint NOT NULL,
	"bomb_hit" boolean NOT NULL,
	"opened_bag_count" smallint NOT NULL,
	"request_id" uuid,
	"ended_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duel_round_results_match_explorer_round_pk" PRIMARY KEY("match_id","explorer_role","round_number"),
	CONSTRAINT "duel_round_results_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "duel_round_results_round_number_check" CHECK ("duel_round_results"."round_number" between 1 and 20),
	CONSTRAINT "duel_round_results_roles_check" CHECK ("duel_round_results"."explorer_role" in ('A', 'B') and "duel_round_results"."placement_role" in ('A', 'B') and "duel_round_results"."explorer_role" <> "duel_round_results"."placement_role"),
	CONSTRAINT "duel_round_results_end_reason_check" CHECK ("duel_round_results"."end_reason" in ('bombed', 'cashed_out', 'cleared')),
	CONSTRAINT "duel_round_results_captured_coins_check" CHECK ("duel_round_results"."captured_coins" between 0 and 3),
	CONSTRAINT "duel_round_results_opened_bag_count_check" CHECK ("duel_round_results"."opened_bag_count" between 1 and 8),
	CONSTRAINT "duel_round_results_terminal_open_order_check" CHECK ("duel_round_results"."terminal_open_order" is null or "duel_round_results"."terminal_open_order" between 1 and "duel_round_results"."opened_bag_count"),
	CONSTRAINT "duel_round_results_state_check" CHECK ((
        "duel_round_results"."end_reason" = 'bombed'
        and "duel_round_results"."bomb_hit" = true
        and "duel_round_results"."captured_coins" = 0
        and "duel_round_results"."terminal_open_order" = "duel_round_results"."opened_bag_count"
      ) or (
        "duel_round_results"."end_reason" = 'cashed_out'
        and "duel_round_results"."bomb_hit" = false
        and "duel_round_results"."captured_coins" in (1, 2)
        and "duel_round_results"."terminal_open_order" is null
      ) or (
        "duel_round_results"."end_reason" = 'cleared'
        and "duel_round_results"."bomb_hit" = false
        and "duel_round_results"."captured_coins" = 3
        and "duel_round_results"."terminal_open_order" = "duel_round_results"."opened_bag_count"
      ))
);
--> statement-breakpoint
ALTER TABLE "duel_matches" ADD COLUMN "formation_version" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "duel_matches" ADD COLUMN "rule_version" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "duel_round_opens" ADD CONSTRAINT "duel_round_opens_explorer_fk" FOREIGN KEY ("match_id","explorer_role") REFERENCES "public"."duel_participants"("match_id","role") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_round_opens" ADD CONSTRAINT "duel_round_opens_placement_fk" FOREIGN KEY ("match_id","placement_role","round_number") REFERENCES "public"."duel_round_placements"("match_id","participant_role","round_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_round_placements" ADD CONSTRAINT "duel_round_placements_participant_fk" FOREIGN KEY ("match_id","participant_role") REFERENCES "public"."duel_participants"("match_id","role") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_round_results" ADD CONSTRAINT "duel_round_results_explorer_fk" FOREIGN KEY ("match_id","explorer_role") REFERENCES "public"."duel_participants"("match_id","role") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_round_results" ADD CONSTRAINT "duel_round_results_placement_fk" FOREIGN KEY ("match_id","placement_role","round_number") REFERENCES "public"."duel_round_placements"("match_id","participant_role","round_number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_matches" ADD CONSTRAINT "duel_matches_formation_version_check" CHECK ("duel_matches"."formation_version" >= 1);--> statement-breakpoint
ALTER TABLE "duel_matches" ADD CONSTRAINT "duel_matches_rule_version_check" CHECK ("duel_matches"."rule_version" >= 1);
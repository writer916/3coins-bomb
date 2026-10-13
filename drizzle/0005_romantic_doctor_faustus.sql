CREATE TABLE "daily_challenge_placements" (
	"challenge_date" date NOT NULL,
	"round_number" smallint NOT NULL,
	"bag_count" smallint NOT NULL,
	"bomb_bag_number" smallint NOT NULL,
	"coin_bag_numbers" smallint[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_challenge_placements_date_round_pk" PRIMARY KEY("challenge_date","round_number"),
	CONSTRAINT "daily_challenge_placements_round_number_check" CHECK ("daily_challenge_placements"."round_number" between 1 and 20),
	CONSTRAINT "daily_challenge_placements_bag_count_check" CHECK ("daily_challenge_placements"."bag_count" between 3 and 8),
	CONSTRAINT "daily_challenge_placements_bomb_bag_number_check" CHECK ("daily_challenge_placements"."bomb_bag_number" between 1 and "daily_challenge_placements"."bag_count"),
	CONSTRAINT "daily_challenge_placements_coin_count_check" CHECK (array_ndims("daily_challenge_placements"."coin_bag_numbers") = 1
        and cardinality("daily_challenge_placements"."coin_bag_numbers") = 3
        and array_lower("daily_challenge_placements"."coin_bag_numbers", 1) = 1
        and array_upper("daily_challenge_placements"."coin_bag_numbers", 1) = 3
        and array_position("daily_challenge_placements"."coin_bag_numbers", null) is null),
	CONSTRAINT "daily_challenge_placements_coin_bag_numbers_check" CHECK ((
        ("daily_challenge_placements"."coin_bag_numbers")[1] between 1 and "daily_challenge_placements"."bag_count"
        and ("daily_challenge_placements"."coin_bag_numbers")[2] between 1 and "daily_challenge_placements"."bag_count"
        and ("daily_challenge_placements"."coin_bag_numbers")[3] between 1 and "daily_challenge_placements"."bag_count"
        and ("daily_challenge_placements"."coin_bag_numbers")[1] <> "daily_challenge_placements"."bomb_bag_number"
        and ("daily_challenge_placements"."coin_bag_numbers")[2] <> "daily_challenge_placements"."bomb_bag_number"
        and ("daily_challenge_placements"."coin_bag_numbers")[3] <> "daily_challenge_placements"."bomb_bag_number"
        and ("daily_challenge_placements"."coin_bag_numbers")[1] <= ("daily_challenge_placements"."coin_bag_numbers")[2]
        and ("daily_challenge_placements"."coin_bag_numbers")[2] <= ("daily_challenge_placements"."coin_bag_numbers")[3]
      ))
);
--> statement-breakpoint
CREATE TABLE "daily_challenges" (
	"challenge_date" date PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"formation_version" smallint DEFAULT 1 NOT NULL,
	"rule_version" smallint DEFAULT 1 NOT NULL,
	CONSTRAINT "daily_challenges_formation_version_check" CHECK ("daily_challenges"."formation_version" >= 1),
	CONSTRAINT "daily_challenges_rule_version_check" CHECK ("daily_challenges"."rule_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "daily_challenge_placements" ADD CONSTRAINT "daily_challenge_placements_challenge_date_daily_challenges_challenge_date_fk" FOREIGN KEY ("challenge_date") REFERENCES "public"."daily_challenges"("challenge_date") ON DELETE cascade ON UPDATE no action;
import { existsSync } from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { createGame } from "../src/domain/game.js";
import type { GameState, Team } from "../src/domain/types.js";
import { checkClueLegality } from "./ai/legality.js";
import { planGuesses } from "./ai/operative.js";
import { unresolvedClues } from "../src/domain/clues.js";
import { generateClue } from "./ai/spymaster.js";
import { analyzeProvidedClue, resolveGuesses, runTurn } from "./ai/turn.js";
import type { SemanticSpace } from "./semantic/space.js";
import { simulateGames } from "./simulation.js";
import { RoomStore } from "./rooms.js";

const teamSchema = z.enum(["red", "blue"]);
const roleSchema = z.enum(["red", "blue", "neutral", "assassin"]);
const profileSchema = z.enum(["cautious", "balanced", "daring"]);
const ambitionSchema = z.enum(["focused", "balanced", "broad"]);
const controllerSchema = z.enum(["human", "ai"]);
const participantRoleSchema = z.enum(["spymaster", "operative", "spectator"]);
const cardSchema = z.object({
  word: z.string().min(1),
  role: roleSchema,
  revealed: z.boolean()
});
const turnRecordSchema = z.object({
  turn: z.number().int(),
  team: teamSchema,
  clue: z.string(),
  number: z.number().int(),
  targetWords: z.array(z.string()),
  guesses: z.array(
    z.object({
      index: z.number().int(),
      word: z.string(),
      role: roleSchema,
      similarity: z.number()
    })
  ),
  remaining: z.number().int().min(0).max(9).optional(),
  endedBy: z.enum(["limit", "wrong-card", "assassin", "victory", "stopped"])
});
const gameStateSchema = z.object({
  id: z.string(),
  seed: z.number().int(),
  cards: z.array(cardSchema).length(25),
  turn: teamSchema,
  startingTeam: teamSchema,
  turnNumber: z.number().int().positive(),
  winner: teamSchema.nullable(),
  history: z.array(turnRecordSchema)
});

function asGameState(value: unknown): GameState {
  return gameStateSchema.parse(value) as GameState;
}

function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void> | void
) {
  return (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export function createApp(semantic: SemanticSpace) {
  const app = express();
  const rooms = new RoomStore();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/status", (_request, response) => {
    response.json({
      ok: true,
      model: semantic.metadata,
      modes: ["ai-vs-ai", "human-operative", "human-spymaster"],
      multiplayer: { rooms: true, transport: "rest" }
    });
  });

  app.post(
    "/api/rooms",
    asyncRoute((request, response) => {
      const body = z.object({ hostName: z.string().min(1).max(32).default("Игрок") }).parse(request.body ?? {});
      response.status(201).json(rooms.create(body.hostName));
    })
  );

  app.get("/api/rooms/:code", (request, response) => {
    response.json(rooms.get(String(request.params.code)));
  });

  app.post(
    "/api/rooms/:code/players",
    asyncRoute((request, response) => {
      const body = z
        .object({
          name: z.string().min(1).max(32),
          controller: controllerSchema.optional(),
          team: teamSchema.nullable().optional(),
          role: participantRoleSchema.optional(),
          profile: profileSchema.optional(),
          ambition: ambitionSchema.optional()
        })
        .parse(request.body);
      response.status(201).json(rooms.join(String(request.params.code), body));
    })
  );

  app.patch(
    "/api/rooms/:code/players/:playerId",
    asyncRoute((request, response) => {
      const body = z
        .object({
          name: z.string().min(1).max(32).optional(),
          controller: controllerSchema.optional(),
          team: teamSchema.nullable().optional(),
          role: participantRoleSchema.optional(),
          profile: profileSchema.optional(),
          ambition: ambitionSchema.optional(),
          connected: z.boolean().optional()
        })
        .parse(request.body);
      response.json(rooms.updateParticipant(String(request.params.code), String(request.params.playerId), body));
    })
  );

  app.post(
    "/api/games",
    asyncRoute((request, response) => {
      const body = z
        .object({
          seed: z.number().int().optional(),
          startingTeam: teamSchema.optional()
        })
        .parse(request.body ?? {});
      response.status(201).json(createGame(semantic.boardWords(), body.seed, body.startingTeam));
    })
  );

  app.post(
    "/api/clues",
    asyncRoute((request, response) => {
      const body = z
        .object({
          state: gameStateSchema,
          team: teamSchema.optional(),
          maxNumber: z.number().int().min(1).max(9).optional(),
          ambition: ambitionSchema.optional(),
          neighborsPerTarget: z.number().int().min(16).max(192).optional()
        })
        .parse(request.body);
      const state = body.state as GameState;
      response.json(
        generateClue(semantic, state.cards, body.team ?? state.turn, {
          maxNumber: body.maxNumber,
          ambition: body.ambition,
          neighborsPerTarget: body.neighborsPerTarget
        })
      );
    })
  );

  app.post(
    "/api/clues/analyze",
    asyncRoute((request, response) => {
      const body = z
        .object({
          state: gameStateSchema,
          clue: z.string().min(1).max(32),
          number: z.number().int().min(1).max(9),
          allowUnknown: z.boolean().optional()
        })
        .parse(request.body);
      response.json(analyzeProvidedClue(semantic, body.state as GameState, body.clue, body.number, body.allowUnknown));
    })
  );

  app.post(
    "/api/guesses",
    asyncRoute((request, response) => {
      const body = z
        .object({
          state: gameStateSchema,
          clue: z.string().min(1).max(32),
          number: z.number().int().min(1).max(9),
          profile: profileSchema.default("balanced"),
          seed: z.number().int().optional()
        })
        .parse(request.body);
      response.json(
        planGuesses(
          semantic,
          body.state.cards,
          body.clue,
          body.number,
          body.profile,
          body.seed ?? body.state.seed + body.state.turnNumber,
          unresolvedClues(body.state.history as GameState["history"], body.state.turn)
        )
      );
    })
  );

  app.post(
    "/api/turns",
    asyncRoute((request, response) => {
      const body = z
        .object({
          state: gameStateSchema,
          profile: profileSchema.default("balanced"),
          clue: z.string().min(1).max(32).optional(),
          number: z.number().int().min(1).max(9).optional(),
          maxClueNumber: z.number().int().min(1).max(9).optional(),
          clueAmbition: ambitionSchema.optional(),
          allowUnknownClue: z.boolean().optional()
        })
        .parse(request.body);
      response.json(
        runTurn(semantic, body.state as GameState, {
          profile: body.profile,
          providedClue: body.clue,
          providedNumber: body.number,
          maxClueNumber: body.maxClueNumber,
          clueAmbition: body.clueAmbition,
          allowUnknownClue: body.allowUnknownClue
        })
      );
    })
  );

  app.post(
    "/api/turns/resolve",
    asyncRoute((request, response) => {
      const body = z
        .object({
          state: gameStateSchema,
          clue: z.string().min(1).max(32),
          number: z.number().int().min(1).max(9),
          picks: z.array(z.number().int().min(0).max(24)).max(25),
          stoppedEarly: z.boolean().optional(),
          allowUnknown: z.boolean().optional()
        })
        .parse(request.body);
      const state = body.state as GameState;
      const analysis = analyzeProvidedClue(semantic, state, body.clue, body.number, body.allowUnknown);
      response.json({
        clue: analysis,
        ...resolveGuesses(state, analysis, body.picks, body.stoppedEarly)
      });
    })
  );

  app.post(
    "/api/legality",
    asyncRoute((request, response) => {
      const body = z
        .object({ clue: z.string(), boardWords: z.array(z.string()).length(25) })
        .parse(request.body);
      response.json({
        ...checkClueLegality(body.clue, body.boardWords, semantic),
        inVocabulary: semantic.hasWord(body.clue)
      });
    })
  );

  app.post(
    "/api/simulations",
    asyncRoute((request, response) => {
      const body = z
        .object({
          games: z.number().int().min(1).max(500).default(100),
          seed: z.number().int().optional(),
          redProfile: profileSchema.default("balanced"),
          blueProfile: profileSchema.default("balanced")
        })
        .parse(request.body ?? {});
      response.json(simulateGames(semantic, body));
    })
  );

  app.get("/api/words/:word", (request, response) => {
    const word = String(request.params.word ?? "");
    response.json({ word, exists: semantic.hasWord(word) });
  });

  app.get("/api/associations/:word", (request, response) => {
    const word = String(request.params.word ?? "");
    const limit = Math.max(1, Math.min(50, Number(request.query.limit ?? 20)));
    response.json({ word, associations: semantic.neighborsWithScores(word, limit) });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({ error: "Некорректные данные запроса.", details: error.issues });
      return;
    }
    const message = error instanceof Error ? error.message : "Неизвестная ошибка.";
    response.status(400).json({ error: message });
  });

  const distDirectory = path.resolve(process.cwd(), "dist");
  if (existsSync(distDirectory)) {
    app.use(express.static(distDirectory));
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile(path.join(distDirectory, "index.html"));
    });
  }

  return app;
}

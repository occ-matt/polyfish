export const CONFIG = {
	// Scene
	fogColor: 0x1b2c71, // RGB(0.106, 0.173, 0.443)
	fogStart: 0,
	fogEnd: 35,
	cameraNearClip: 0.08,
	cameraFarClip: 800,
	cameraFOV: 80, // Unity FOV is 80, not 75
	ambientLightColor: 0x233943, // RGB(0.138, 0.223, 0.265)
	ambientLightIntensity: 5.25,
	directionalLightColor: 0xaaccff,
	directionalLightIntensity: 2.7,
	directionalShadowStrength: 1.0,

	// Ocean surface height — single source of truth for the water line.
	// Everything uses this: dolphin breathing, kelp clamping, ocean surface mesh, boundary yMax.
	// Terrain base is ~-7.81, so surfaceY of 6.65 gives ~14.5 units of water column.
	surfaceY: 8.0,

	// Pools
	poolSizes: {
		fish: 60,
		dolphin: 15,
		manatee: 10,
		food: 80,
		seed: 30,
		plant: 60,
	},

	// Creature defaults - calibrated from Unity scene/prefab data
	creatures: {
		fish: {
			speed: 0.2,
			thrustMultiplier: 8.36,
			lookTime: 6.0,
			engineBurnTime: 0.43,
			foodTag: "food",
			foodToReproduce: 4,
			foodToLeaveWaste: 3,
			leaveWaste: true,
			minLifetime: 60,
			hasMetabolism: true,
			metabolicClock: 2,
			startingMetabolism: 60,
			energyUsedPerMinute: 60,
			foodEnergy: 4,
			mass: 2.0,
			drag: 2.27,
			angularDrag: 0.9,
			mouthRadius: 0.15,
			mouthOffset: 0.4, // past capsule front edge
			capsuleRadius: 0.1,
			capsuleHalfHeight: 0.008,
			scale: 10,
			color: 0x44aaff,
			fleeRadius: 1.5, // Detection radius for nearby predators (halved from 3.0)
		},
		dolphin: {
			speed: 0.25,
			thrustMultiplier: 10,
			lookTime: 2.7,
			engineBurnTime: 1.0,
			foodTag: "creature_fish",
			foodToReproduce: 5,
			foodToLeaveWaste: 5,
			leaveWaste: true,
			minLifetime: 120,
			hasMetabolism: true,
			metabolicClock: 2,
			startingMetabolism: 120,
			energyUsedPerMinute: 30,
			foodEnergy: 5,
			mass: 2.0,
			drag: 2.0,
			angularDrag: 0.9,
			mouthRadius: 0.5,
			mouthOffset: 1.25, // past the body capsule, but give fish a fighting chance
			capsuleRadius: 0.275,
			capsuleHalfHeight: 0.075,
			scale: 10,
			color: 0x6688cc,
			killSprint: true,
			// Oxygen system - dolphins must surface periodically to breathe
			oxygen: {
				max: 1.0, // Full tank (0–1 gauge)
				depleteRate: 0.0167, // Drains in ~60s
				refillRate: 0.25,    // Refills in ~2s at surface
				surfaceY: -4.65,     // Y threshold (synced with CONFIG.surfaceY at init)
				urgentThreshold: 0.3,
				criticalThreshold: 0.1,
			},
		},
		manatee: {
			speed: 0.2,
			thrustMultiplier: 6.69,
			lookTime: 1.0,
			engineBurnTime: 0.9,
			foodTag: "plant",
			foodToReproduce: 7,
			foodToLeaveWaste: 4,
			leaveWaste: true,
			minLifetime: 120,
			hasMetabolism: true,
			metabolicClock: 2,
			startingMetabolism: 100,
			energyUsedPerMinute: 50,
			foodEnergy: 4,
			mass: 3.5,
			drag: 1.65,
			angularDrag: 0.25,
			mouthRadius: 0.5,
			mouthOffset: 0.7, // past capsule front edge
			capsuleRadius: 0.208,
			capsuleHalfHeight: 0.008,
			scale: 10,
			color: 0x88aa88,
			fleeRadius: 0, // Manatees have no natural predators
		},
	},

	// Food chain - defines predator-prey relationships for the ecosystem.
	// Adding a new creature type only requires adding entries here (plus config above).
	// eatCategory: 'food' (particles), 'creature' (other creatures), 'plant' (kelp)
	// preyTypes: which creature types count as valid prey (for creature-eats-creature)
	// eatenBy: which creature types hunt this one (used by flee logic)
	foodChain: {
		fish:    { eatCategory: 'food',     preyTypes: [],       eatenBy: ['dolphin'] },
		dolphin: { eatCategory: 'creature', preyTypes: ['fish'], eatenBy: [] },
		manatee: { eatCategory: 'plant',    preyTypes: [],       eatenBy: [] },
	},

	// Dash mechanic — occasional burst of speed toward food target
	dash: {
		probabilityPerSecond: 0.15, // ~15% chance to trigger a dash each second when approaching food
		speedMultiplier: 2.5, // Dash moves at 2.5x normal speed
		duration: 0.4, // Dash lasts 0.4 seconds
		cooldown: 2.0, // Minimum time between dashes
	},

	// Reproduction limits
	maxOffspring: 12, // Hard cap: each creature can reproduce at most 8 times
	reproCooldown: 10, // Seconds after reproducing before eligible again
	geneticMutation: false, // When true, offspring get randomized speed/drag/burn stats

	// Plant lifecycle
	plant: {
		minLifetime: 50, // Base lifespan in seconds (randomized ±25%)
		foodRateYoung: 1, // Seconds between food spawns when young
		foodRateOld: 8, // Seconds between food spawns near end of life
		collisionRadius: 0.4, // Horizontal push radius for creature interaction (world units)
		ragdollSegments: 12, // Number of procedural bones (was 4 from GLB). More = smoother bend.
	},

	// Seed germination
	seedGermination: {
		baseChance: 0.4, // Base probability of sprouting
		densityRadius: 1.33, // Radius to check for nearby plants
		densityPenalty: 0.25, // Chance reduction per nearby plant (was 0.12 — too mild)
		minChance: 0.02, // Floor — tiny chance even in dense areas
	},

	// Entity scales (non-creature)
	kelpScale: 24,
	foodScale: 1,
	seedScale: 2,

	// Entity tint colors
	foodColor: 0x88ffaa,
	seedColor: 0x8b6914, // brown

	// Spawner
	spawner: {
		radius: 1.33,
		wasteRate: 2.5,
		upForceMin: 1,
		upForceMax: 7,
	},

	// World boundary (soft — creatures get steered back)
	boundary: {
		radius: 128,
		yMin: -9.5, // Below terrain surface (terrain base at -7.81)
		yMax: 6.65, // Matches CONFIG.surfaceY — nothing goes above the water line
		steerForce: 5.0,
	},

	// Scene flow
	restartDelay: 30,
	minPopulation: 0,
	populationCheckInterval: 2,
	fadeTime: 2.0,

	// Marine snow
	marineSnow: {
		count: 500,
		spread: 100,
		speed: 0.3,
		size: 0.05,
	},

	// Underwater caustics (procedural light refraction patterns)
	caustics: {
		intensity: 0.09, // Brightness of caustic light (0–1). Higher = more visible pattern.
		scale: 0.22, // Spatial frequency of the Voronoi pattern. Lower = larger cells.
		speed: 0.4, // Animation speed of cell center movement.
		fadeDepth: 30.0, // Distance below surface where caustics fully fade out (units).
		distanceFade: 25.0, // Distance from camera where caustics start fading out (units).
	},

	// Volumetric god rays (light shafts from the surface, shares caustic pattern)
	// Toggle via URL: ?useGodrays=0 to disable
	godrays: {
		intensity: 1.05,  // Overall brightness of the light shafts (0-2).
		density: 0.3,    // How dense/opaque the shafts appear.
		maxDist: 18.0,   // Max raymarch distance per fragment (units). Lower = cheaper.
		floorReach: 0.06, // How often rays reach the floor (0 = never, 1 = always). Controls fade depth.
		beamScale: 0.22, // Spatial frequency of beams. Lower = wider, fewer beams.
		tilt: 0.42,      // How much beams tilt from vertical (sun angle). 0 = straight down.
		smoothK: 0.4,    // Smooth Voronoi sharpness. Lower = softer beam edges. Higher = sharper cells.
		animSpeed: 3.38,  // Animation speed multiplier for beam pattern (1.0 = default caustic speed).
	},

	// Water surface
	waterSurface: {
		noiseStrength: 3.0,
		noiseSpeed: 2.0,
		noiseScale: 0.12,
		updateInterval: 0.2,
	},

	// Narration timeline (seconds from start)
	narration: {
		intro: 4.15,
		polyfishIntro: 7.15,
		manateeIntro: 74.15,
		dolphinIntro: 104.65,
	},

};

import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

// Agregamos esto para entornos ESM si Node no reconoce las globales de Mocha
import mocha from "mocha";
const { describe, it, beforeEach } = mocha;

describe("Kahoot Web3 - Patron Commit/Reveal", function () {
  let diplomaNFT, kahootManager;
  let owner, profesor, alumnoHonesto, alumnoTramposo;

  // Variables de la partida
  const passingScore = 1;
  const totalQuestions = 1;
  const metadataURI = "ipfs://QmMockMetadata...";
  const diplomaURI = "ipfs://QmMockDiploma...";
  const correctAnswers = [1]; // La opcion correcta para la Pregunta 0 es la '1' (B)

  beforeEach(async function () {
    // Obtenemos cuentas de prueba
    [owner, profesor, alumnoHonesto, alumnoTramposo] = await ethers.getSigners();

    // 1. Desplegamos el Diploma
    const Diploma = await ethers.getContractFactory("DiplomaNFT");
    diplomaNFT = await Diploma.deploy(owner.address);

    // 2. Desplegamos el Manager
    const Manager = await ethers.getContractFactory("KahootManager");
    const diplomaAddress = await diplomaNFT.getAddress();
    kahootManager = await Manager.deploy(diplomaAddress);

    // 3. Le damos permisos al Manager para mintear diplomas
    const managerAddress = await kahootManager.getAddress();
    await diplomaNFT.connect(owner).setKahootManager(managerAddress);
  });

  it("Deberia ejecutar una partida completa y entregar el diploma", async function () {
    // ==========================================
    // FASE 1: CREACION (Profesor)
    // ==========================================
    await kahootManager.connect(profesor).createGame(
      passingScore,
      totalQuestions,
      metadataURI,
      diplomaURI,
      correctAnswers
    );
    const gameId = 0; // Es el primer juego creado

    // El profe abre la pregunta 0
    await kahootManager.connect(profesor).startNextQuestion(gameId);

    // ==========================================
    // FASE 2: COMMIT (Alumnos en el Frontend)
    // ==========================================
    // Alumno Honesto elige la opcion 1 (Correcta) y un salt secreto
    const saltHonesto = "secreto-perrito123";
    const opcionHonesto = 1;
    
    // ASI SE HASHEA EN EL FRONTEND (Ethers v6):
    const hashHonesto = ethers.solidityPackedKeccak256(
      ["uint8", "string"],
      [opcionHonesto, saltHonesto]
    );

    // Alumno Tramposo elige la opcion 2 (Incorrecta)
    const saltTramposo = "secreto-gato456";
    const opcionTramposo = 2;
    const hashTramposo = ethers.solidityPackedKeccak256(
      ["uint8", "string"],
      [opcionTramposo, saltTramposo]
    );

    // Mandan los hashes a la blockchain
    await kahootManager.connect(alumnoHonesto).commitAnswer(gameId, hashHonesto);
    await kahootManager.connect(alumnoTramposo).commitAnswer(gameId, hashTramposo);

    // ==========================================
    // FASE 3: CIERRE DE PREGUNTA (Profesor)
    // ==========================================
    await kahootManager.connect(profesor).closeQuestionAndStartReveal(gameId);

    // ==========================================
    // FASE 4: REVEAL (Alumnos)
    // ==========================================
    // Revelan sus respuestas en texto plano
    await kahootManager.connect(alumnoHonesto).revealAnswer(gameId, 0, opcionHonesto, saltHonesto);
    await kahootManager.connect(alumnoTramposo).revealAnswer(gameId, 0, opcionTramposo, saltTramposo);

    // Verificamos los puntajes on-chain
    expect(await kahootManager.scores(gameId, alumnoHonesto.address)).to.equal(1);
    expect(await kahootManager.scores(gameId, alumnoTramposo.address)).to.equal(0);

    // El profe avanza la partida (como era 1 sola pregunta, se termina)
    await kahootManager.connect(profesor).advanceToNextQuestion(gameId);

    // ==========================================
    // FASE 5: RECLAMO DE DIPLOMA
    // ==========================================
    // El alumno honesto reclama su diploma
    await kahootManager.connect(alumnoHonesto).claimDiploma(gameId);

    // Verificamos que el NFT ahora es del alumno honesto
    expect(await diplomaNFT.ownerOf(0)).to.equal(alumnoHonesto.address);
    // Verificamos que tiene la metadata correcta que eligio el profe
    expect(await diplomaNFT.tokenURI(0)).to.equal(diplomaURI);

    // Si el tramposo intenta reclamar, la transaccion debe fallar (Revertir)
    await expect(
        kahootManager.connect(alumnoTramposo).claimDiploma(gameId)
    ).to.be.revertedWith("No alcanzas el puntaje minimo");
  });

  it("Deberia fallar si un alumno intenta revelar con un hash falso", async function () {
    await kahootManager.connect(profesor).createGame(1, 1, metadataURI, diplomaURI, [1]);
    await kahootManager.connect(profesor).startNextQuestion(0);

    // El alumno hace commit de una respuesta incorrecta (Opción 2)
    const hashReal = ethers.solidityPackedKeccak256(["uint8", "string"], [2, "secreto"]);
    await kahootManager.connect(alumnoTramposo).commitAnswer(0, hashReal);

    await kahootManager.connect(profesor).closeQuestionAndStartReveal(0);

    // Intenta revelar diciendo que en realidad eligió la opción 1 (La correcta)
    await expect(
        kahootManager.connect(alumnoTramposo).revealAnswer(0, 0, 1, "secreto")
    ).to.be.revertedWith("El hash no coincide");
  });
});
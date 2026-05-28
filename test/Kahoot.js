import { expect } from "chai";
import { network } from "hardhat";
import { describe, it, beforeEach } from "node:test";
import { keccak256, encodePacked, parseEther } from "viem";

describe("Kahoot Web3 - Patrón Factory y Commit/Reveal Seguro", function () {
  let factory, game, diplomaNFT;
  let owner, profesor, alumnoHonesto, alumnoTramposo, alumnoExtra;
  let viem;

  const metadataURI = "ipfs://QmMockMetadata...";
  const diplomaURI = "ipfs://QmMockDiploma...";
  const profeSalt = "secretoProfe";
  const entryFee = parseEther("0.01");

  function generateHash(opcion, salt, address) {
    return keccak256(
      encodePacked(
        ["uint8", "string", "address"],
        [opcion, salt, address]
      )
    );
  }

  async function expectRevert(promise, expectedReason) {
    try {
      await promise;
      expect.fail("La transaccion deberia haber fallado");
    } catch (error) {
      expect(error.message).to.include(expectedReason);
    }
  }

  beforeEach(async function () {
    const networkContext = await network.create({
      network: "hardhatMainnet",
      chainType: "l1",
    });
    viem = networkContext.viem;

    const walletClients = await viem.getWalletClients();
    [owner, profesor, alumnoHonesto, alumnoTramposo, alumnoExtra] = walletClients;

    factory = await viem.deployContract("KahootFactory");

    const hashRespuesta1 = generateHash(1, profeSalt, profesor.account.address);

    await factory.write.createGame(
      [1n, 1n, metadataURI, diplomaURI, [hashRespuesta1], entryFee],
      { account: profesor.account }
    );

    const gameAddress = await factory.read.games([0n]);
    game = await viem.getContractAt("KahootGame", gameAddress);

    const diplomaAddress = await game.read.diplomaContract();
    diplomaNFT = await viem.getContractAt("DiplomaNFT", diplomaAddress);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS EXISTENTES (Happy Path)
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 1: El copion no puede robar el hash", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.joinGame({ value: entryFee, account: alumnoTramposo.account });

    await game.write.startNextQuestion({ account: profesor.account });

    const hashHonesto = generateHash(1, "secreto", alumnoHonesto.account.address);
    
    await game.write.commitAnswer([hashHonesto], { account: alumnoHonesto.account });
    await game.write.commitAnswer([hashHonesto], { account: alumnoTramposo.account });

    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });

    await game.write.revealAnswer([0n, 1, "secreto"], { account: alumnoHonesto.account });
    expect(await game.read.scores([alumnoHonesto.account.address])).to.equal(1n);

    await expectRevert(
      game.write.revealAnswer([0n, 1, "secreto"], { account: alumnoTramposo.account }),
      "El hash no coincide"
    );
  });

  it("TEST 2: Deberia fallar si intentan acciones fuera de fase", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.joinGame({ value: entryFee, account: alumnoTramposo.account });

    const hash = generateHash(1, "salt", alumnoHonesto.account.address);

    await expectRevert(
      game.write.commitAnswer([hash], { account: alumnoHonesto.account }),
      "Fase de commit cerrada"
    );

    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([hash], { account: alumnoHonesto.account });

    await expectRevert(
      game.write.revealAnswer([0n, 1, "salt"], { account: alumnoHonesto.account }),
      "Fase de reveal cerrada"
    );

    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });

    const hash2 = generateHash(2, "salt2", alumnoTramposo.account.address);
    await expectRevert(
      game.write.commitAnswer([hash2], { account: alumnoTramposo.account }),
      "Fase de commit cerrada"
    );
  });

  it("TEST 3: Proteccion de Doble Claim", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });

    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([generateHash(1, "s1", alumnoHonesto.account.address)], { account: alumnoHonesto.account });
    
    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account }); 
    
    await game.write.revealAnswer([0n, 1, "s1"], { account: alumnoHonesto.account });
    await game.write.advanceToNextQuestion({ account: profesor.account });

    await game.write.claimDiploma({ account: alumnoHonesto.account });

    await expectRevert(
      game.write.claimDiploma({ account: alumnoHonesto.account }),
      "Ya reclamaste tu diploma"
    );
  });

  it("TEST 4: Seguridad del Profesor", async function () {
    await expectRevert(
      game.write.startNextQuestion({ account: alumnoTramposo.account }),
      "Solo el profe puede ejecutar esto"
    );

    await expectRevert(
      game.write.closeQuestionAndStartReveal([1, "fake"], { account: alumnoTramposo.account }),
      "Solo el profe puede ejecutar esto"
    );
  });

  it("TEST 5: Partida completa de 3 preguntas (Loop completo)", async function () {
    const p1 = generateHash(1, profeSalt, profesor.account.address);
    const p2 = generateHash(2, profeSalt, profesor.account.address);
    const p3 = generateHash(2, profeSalt, profesor.account.address);

    await factory.write.createGame(
      [2n, 3n, metadataURI, diplomaURI, [p1, p2, p3], entryFee],
      { account: profesor.account }
    );
    const game3Address = await factory.read.games([1n]);
    const game3 = await viem.getContractAt("KahootGame", game3Address);

    await game3.write.joinGame({ value: entryFee, account: alumnoHonesto.account });

    // Q1
    await game3.write.startNextQuestion({ account: profesor.account });
    await game3.write.commitAnswer([generateHash(1, "s1", alumnoHonesto.account.address)], { account: alumnoHonesto.account });
    await game3.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account }); 
    await game3.write.revealAnswer([0n, 1, "s1"], { account: alumnoHonesto.account });
    await game3.write.advanceToNextQuestion({ account: profesor.account });

    // Q2
    await game3.write.startNextQuestion({ account: profesor.account });
    await game3.write.commitAnswer([generateHash(2, "s2", alumnoHonesto.account.address)], { account: alumnoHonesto.account });
    await game3.write.closeQuestionAndStartReveal([2, profeSalt], { account: profesor.account }); 
    await game3.write.revealAnswer([1n, 2, "s2"], { account: alumnoHonesto.account });
    await game3.write.advanceToNextQuestion({ account: profesor.account });

    // Q3
    await game3.write.startNextQuestion({ account: profesor.account });
    await game3.write.commitAnswer([generateHash(1, "s3", alumnoHonesto.account.address)], { account: alumnoHonesto.account });
    await game3.write.closeQuestionAndStartReveal([2, profeSalt], { account: profesor.account }); 
    await game3.write.revealAnswer([2n, 1, "s3"], { account: alumnoHonesto.account });
    await game3.write.advanceToNextQuestion({ account: profesor.account });

    expect(await game3.read.scores([alumnoHonesto.account.address])).to.equal(2n);
    expect(await game3.read.isFinished()).to.be.true;

    await game3.write.claimDiploma({ account: alumnoHonesto.account });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FÁBRICA - CREACIÓN INVÁLIDA (Reverts)
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 6: Factory revert si _totalQuestions == 0", async function () {
    await expectRevert(
      factory.write.createGame(
        [1n, 0n, metadataURI, diplomaURI, [], entryFee],
        { account: profesor.account }
      ),
      "Debe tener preguntas"
    );
  });

  it("TEST 7: Factory revert si _passingScore == 0", async function () {
    const p1 = generateHash(1, profeSalt, profesor.account.address);
    await expectRevert(
      factory.write.createGame(
        [0n, 1n, metadataURI, diplomaURI, [p1], entryFee],
        { account: profesor.account }
      ),
      "Puntaje invalido"
    );
  });

  it("TEST 8: Factory revert si _passingScore > _totalQuestions", async function () {
    const p1 = generateHash(1, profeSalt, profesor.account.address);
    const p2 = generateHash(2, profeSalt, profesor.account.address);
    await expectRevert(
      factory.write.createGame(
        [5n, 2n, metadataURI, diplomaURI, [p1, p2], entryFee],
        { account: profesor.account }
      ),
      "Puntaje mayor al total"
    );
  });

  it("TEST 9: Factory revert si correctAnswers.length != _totalQuestions", async function () {
    const p1 = generateHash(1, profeSalt, profesor.account.address);
    const p2 = generateHash(2, profeSalt, profesor.account.address);
    await expectRevert(
      factory.write.createGame(
        [2n, 3n, metadataURI, diplomaURI, [p1, p2], entryFee],
        { account: profesor.account }
      ),
      "Respuestas no coinciden"
    );
  });

  it("TEST 10: Factory revert si correctAnswers tiene MÁS elementos que _totalQuestions", async function () {
    const p1 = generateHash(1, profeSalt, profesor.account.address);
    await expectRevert(
      factory.write.createGame(
        [1n, 1n, metadataURI, diplomaURI, [p1, p1, p1], entryFee],
        { account: profesor.account }
      ),
      "Respuestas no coinciden"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // JUEGO - ALUMNO DESAPROBADO (Revert)
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 11: Alumno desaprobado no puede reclamar diploma", async function () {
    const p1 = generateHash(1, profeSalt, profesor.account.address);
    const p2 = generateHash(2, profeSalt, profesor.account.address);

    await factory.write.createGame(
      [2n, 2n, metadataURI, diplomaURI, [p1, p2], entryFee], 
      { account: profesor.account }
    );
    const gameAddr = await factory.read.games([1n]);
    const gameDesa = await viem.getContractAt("KahootGame", gameAddr);

    await gameDesa.write.joinGame({ value: entryFee, account: alumnoHonesto.account });

    // Q1
    await gameDesa.write.startNextQuestion({ account: profesor.account });
    await gameDesa.write.commitAnswer([generateHash(3, "wrong1", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    await gameDesa.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });
    await gameDesa.write.revealAnswer([0n, 3, "wrong1"], { account: alumnoHonesto.account });
    await gameDesa.write.advanceToNextQuestion({ account: profesor.account });

    // Q2
    await gameDesa.write.startNextQuestion({ account: profesor.account });
    await gameDesa.write.commitAnswer([generateHash(2, "right2", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    await gameDesa.write.closeQuestionAndStartReveal([2, profeSalt], { account: profesor.account });
    await gameDesa.write.revealAnswer([1n, 2, "right2"], { account: alumnoHonesto.account });
    await gameDesa.write.advanceToNextQuestion({ account: profesor.account });

    expect(await gameDesa.read.isFinished()).to.be.true;
    expect(await gameDesa.read.scores([alumnoHonesto.account.address])).to.equal(1n);

    await expectRevert(
      gameDesa.write.claimDiploma({ account: alumnoHonesto.account }),
      "No alcanzas el puntaje"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // JUEGO - REVELACIÓN FANTASMA Y NULA (Reverts)
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 12: Reveal sin haber hecho commit previo (revelación fantasma)", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.joinGame({ value: entryFee, account: alumnoTramposo.account });

    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([generateHash(1, "s1", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    
    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });

    await expectRevert(
      game.write.revealAnswer([0n, 1, "fake"], { account: alumnoTramposo.account }),
      "No hiciste commit"
    );
  });

  it("TEST 13: Commit de bytes32(0) debería fallar", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.startNextQuestion({ account: profesor.account });
    const nullHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

    await expectRevert(
      game.write.commitAnswer([nullHash], { account: alumnoHonesto.account }),
      "Hash nulo"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // JUEGO - COLISIÓN DE FASES (Reverts)
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 14: Profesor no puede abrir pregunta 2 si la pregunta 1 está en commit", async function () {
    const p1 = generateHash(1, profeSalt, profesor.account.address);
    const p2 = generateHash(2, profeSalt, profesor.account.address);
    await factory.write.createGame([1n, 2n, metadataURI, diplomaURI, [p1, p2], entryFee], { account: profesor.account });
    const gameAddr = await factory.read.games([1n]);
    const game2 = await viem.getContractAt("KahootGame", gameAddr);

    await game2.write.startNextQuestion({ account: profesor.account });

    await expectRevert(
      game2.write.advanceToNextQuestion({ account: profesor.account }),
      "Primero hay que abrir los reveals"
    );
  });

  it("TEST 15: Profesor no puede abrir pregunta 2 si la pregunta 1 está en reveal", async function () {
    const p1 = generateHash(1, profeSalt, profesor.account.address);
    const p2 = generateHash(2, profeSalt, profesor.account.address);
    await factory.write.createGame([1n, 2n, metadataURI, diplomaURI, [p1, p2], entryFee], { account: profesor.account });
    const gameAddr = await factory.read.games([1n]);
    const game2 = await viem.getContractAt("KahootGame", gameAddr);

    await game2.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game2.write.startNextQuestion({ account: profesor.account });
    await game2.write.commitAnswer([generateHash(1, "s1", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    
    await game2.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });

    await expectRevert(
      game2.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account }),
      "No esta en fase de commit"
    );
  });

  it("TEST 16: advanceToNextQuestion falla si la fase actual es commit (no reveal)", async function () {
    const p1 = generateHash(1, profeSalt, profesor.account.address);
    const p2 = generateHash(2, profeSalt, profesor.account.address);
    await factory.write.createGame([1n, 2n, metadataURI, diplomaURI, [p1, p2], entryFee], { account: profesor.account });
    const gameAddr = await factory.read.games([1n]);
    const game2 = await viem.getContractAt("KahootGame", gameAddr);

    await game2.write.startNextQuestion({ account: profesor.account });

    await expectRevert(
      game2.write.advanceToNextQuestion({ account: profesor.account }),
      "Primero hay que abrir los reveals"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SEGURIDAD DE ROLES (Reverts)
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 17: Alumno no puede llamar startNextQuestion", async function () {
    await expectRevert(
      game.write.startNextQuestion({ account: alumnoHonesto.account }),
      "Solo el profe puede ejecutar esto"
    );
  });

  it("TEST 18: Alumno no puede llamar closeQuestionAndStartReveal", async function () {
    await game.write.startNextQuestion({ account: profesor.account });

    await expectRevert(
      game.write.closeQuestionAndStartReveal([1, profeSalt], { account: alumnoHonesto.account }),
      "Solo el profe puede ejecutar esto"
    );
  });

  it("TEST 19: Alumno no puede llamar advanceToNextQuestion", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([generateHash(1, "s1", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });

    await expectRevert(
      game.write.advanceToNextQuestion({ account: alumnoHonesto.account }),
      "Solo el profe puede ejecutar esto"
    );
  });

  it("TEST 20: Owner (no profesor) tampoco puede ejecutar funciones de profesor", async function () {
    await expectRevert(
      game.write.startNextQuestion({ account: owner.account }),
      "Solo el profe puede ejecutar esto"
    );

    await expectRevert(
      game.write.closeQuestionAndStartReveal([1, profeSalt], { account: owner.account }),
      "Solo el profe puede ejecutar esto"
    );

    await expectRevert(
      game.write.advanceToNextQuestion({ account: owner.account }),
      "Solo el profe puede ejecutar esto"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EDGE CASES ADICIONALES
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 21: No se puede hacer commit dos veces en la misma pregunta", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.startNextQuestion({ account: profesor.account });

    const hash = generateHash(1, "s1", alumnoHonesto.account.address);
    await game.write.commitAnswer([hash], { account: alumnoHonesto.account });

    const hash2 = generateHash(2, "s2", alumnoHonesto.account.address);
    await expectRevert(
      game.write.commitAnswer([hash2], { account: alumnoHonesto.account }),
      "Ya respondiste"
    );
  });

  it("TEST 22: No se puede hacer reveal dos veces", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([generateHash(1, "s1", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    
    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });
    
    await game.write.revealAnswer([0n, 1, "s1"], { account: alumnoHonesto.account });

    await expectRevert(
      game.write.revealAnswer([0n, 1, "s1"], { account: alumnoHonesto.account }),
      "No hiciste commit en esta pregunta"
    );
  });

  it("TEST 23: claimDiploma falla si el juego no terminó", async function () {
    await expectRevert(
      game.write.claimDiploma({ account: alumnoHonesto.account }),
      "El juego no ha terminado"
    );
  });

  it("TEST 24: startNextQuestion falla cuando no hay más preguntas", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([generateHash(1, "s1", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });
    await game.write.revealAnswer([0n, 1, "s1"], { account: alumnoHonesto.account });
    await game.write.advanceToNextQuestion({ account: profesor.account });

    await expectRevert(
      game.write.startNextQuestion({ account: profesor.account }),
      "El juego termino"
    );
  });

  it("TEST 25: Alumno que nunca jugó no puede reclamar diploma", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([generateHash(1, "s1", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });
    await game.write.revealAnswer([0n, 1, "s1"], { account: alumnoHonesto.account });
    await game.write.advanceToNextQuestion({ account: profesor.account });

    expect(await game.read.isFinished()).to.be.true;

    await expectRevert(
      game.write.claimDiploma({ account: alumnoTramposo.account }),
      "No alcanzas el puntaje minimo"
    );
  });

  it("TEST 26: Reveal con hash incorrecto (salt equivocado)", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([generateHash(1, "mi_salt_real", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });

    await expectRevert(
      game.write.revealAnswer([0n, 1, "salt_falso"], { account: alumnoHonesto.account }),
      "El hash no coincide con tu commit"
    );
  });

  it("TEST 27: Reveal con opción distinta a la commiteada", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([generateHash(1, "salt", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });

    await expectRevert(
      game.write.revealAnswer([0n, 2, "salt"], { account: alumnoHonesto.account }),
      "El hash no coincide con tu commit"
    );
  });

  it("TEST 28: closeQuestionAndStartReveal falla si no hay commit phase abierta", async function () {
    await expectRevert(
      game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account }),
      "No esta en fase de commit"
    );
  });

  it("TEST 29: DiplomaNFT - solo el contrato KahootGame puede mintear", async function () {
    await expectRevert(
      diplomaNFT.write.mintDiploma(
        [alumnoHonesto.account.address, diplomaURI],
        { account: profesor.account }
      ),
      "UnauthorizedGame"
    );
  });

  it("TEST 30: DiplomaNFT - falla con InvalidAddress si game es address(0)", async function () {
    const zeroAddress = "0x0000000000000000000000000000000000000000";
    await expectRevert(
      viem.deployContract("DiplomaNFT", [zeroAddress]),
      "InvalidAddress"
    );
  });

  it("TEST 31: KahootFactory - getGamesCount funciona", async function () {
    const countAntes = await factory.read.getGamesCount();
    const p1 = generateHash(1, profeSalt, profesor.account.address);
    
    await factory.write.createGame(
      [1n, 1n, metadataURI, diplomaURI, [p1], entryFee],
      { account: profesor.account }
    );
    
    const countDespues = await factory.read.getGamesCount();
    expect(countDespues).to.equal(countAntes + 1n);
  });

  it("TEST 32: KahootGame - variables de estado", async function () {
    expect((await game.read.professor()).toLowerCase()).to.equal(profesor.account.address.toLowerCase());
    expect(await game.read.passingScore()).to.equal(1n);
    expect(await game.read.totalQuestions()).to.equal(1n);
    expect(await game.read.metadataURI()).to.equal(metadataURI);
    expect(await game.read.diplomaTokenURI()).to.equal(diplomaURI);
    expect(await game.read.isFinished()).to.be.false;
    expect(await game.read.currentQuestionId()).to.equal(0n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // NUEVO TEST DE SEGURIDAD (Doble Commit-Reveal)
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 33: El Profesor no puede cambiar la respuesta correcta (Doble Commit-Reveal)", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.startNextQuestion({ account: profesor.account });
    
    const hash = generateHash(1, "s1", alumnoHonesto.account.address);
    await game.write.commitAnswer([hash], { account: alumnoHonesto.account });

    await expectRevert(
      game.write.closeQuestionAndStartReveal([2, profeSalt], { account: profesor.account }),
      "Hash de respuesta incorrecto" 
    );

    await expectRevert(
      game.write.closeQuestionAndStartReveal([1, "saltFalso"], { account: profesor.account }),
      "Hash de respuesta incorrecto"
    );

    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });
    expect(await game.read.revealedAnswers([0n])).to.equal(1);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // NUEVO TEST DE SEGURIDAD (Join Game después del inicio)
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 34: Un alumno NO puede unirse después de que comience el juego", async function () {
    // Alumno 1 se une antes de empezar
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    
    // Profesor inicia la partida abriendo la pregunta 1
    await game.write.startNextQuestion({ account: profesor.account });

    // Alumno 2 intenta unirse tarde
    await expectRevert(
      game.write.joinGame({ value: entryFee, account: alumnoTramposo.account }),
      "El juego ya comenzo o ya termino"
    );
  });

});
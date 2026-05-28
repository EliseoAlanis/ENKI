import { expect } from "chai";
import { network } from "hardhat";
import { describe, it, beforeEach } from "node:test";
import { keccak256, encodePacked, parseEther } from "viem";

describe("KahootGame - Fases y Roles", function () {
  let factory, game;
  let owner, profesor, alumnoHonesto, alumnoTramposo, alumnoExtra;
  let viem;

  const diplomaURI = "ipfs://QmMockDiploma...";
  const profeSalt = "secretoProfe";
  const enunciado = "¿Cuánto es 2+2?";
  const opciones = ["A", "B", "C", "D"];
  const entryFee = parseEther("0.01");
  const creationFee = parseEther("0.001");

  function generateHash(opcion, salt, address) {
    return keccak256(
      encodePacked(
        ["uint8", "string", "address"],
        [opcion, salt, address]
      )
    );
  }

  function buildRonda(opcionCorrecta, profesorAddr) {
    return {
      hashVerificacionPregunta: keccak256(encodePacked(
        ["string", "string", "string", "string", "string", "string"],
        [enunciado, opciones[0], opciones[1], opciones[2], opciones[3], profeSalt]
      )),
      hashRespuestaCorrecta: generateHash(opcionCorrecta, profeSalt, profesorAddr),
      commitPhaseOpen: false,
      revealPhaseOpen: false,
    };
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

    factory = await viem.deployContract("KahootFactory", [creationFee]);
    const r1 = buildRonda(1, profesor.account.address);
    await factory.write.createGame(
      [1n, 1n, diplomaURI, [r1], entryFee],
      { account: profesor.account, value: creationFee }
    );
    const gameAddress = await factory.read.games([0n]);
    game = await viem.getContractAt("KahootGame", gameAddress);
  });

  it("Deberia fallar si intentan acciones fuera de fase", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.joinGame({ value: entryFee, account: alumnoTramposo.account });

    const hash = generateHash(1, "salt", alumnoHonesto.account.address);

    await expectRevert(
      game.write.commitAnswer([hash], { account: alumnoHonesto.account }),
      "Fase de commit cerrada"
    );

    await game.write.startNextQuestion([enunciado, opciones, profeSalt], { account: profesor.account });
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

  it("Profesor no puede abrir pregunta 2 si la pregunta 1 está en commit", async function () {
    const r1 = buildRonda(1, profesor.account.address);
    const r2 = buildRonda(2, profesor.account.address);
    await factory.write.createGame([1n, 2n, diplomaURI, [r1, r2], entryFee], { account: profesor.account, value: creationFee });
    const gameAddr = await factory.read.games([1n]);
    const game2 = await viem.getContractAt("KahootGame", gameAddr);

    await game2.write.startNextQuestion([enunciado, opciones, profeSalt], { account: profesor.account });

    await expectRevert(
      game2.write.advanceToNextQuestion({ account: profesor.account }),
      "Primero hay que abrir los reveals"
    );
  });

  it("Profesor no puede abrir pregunta 2 si la pregunta 1 está en reveal", async function () {
    const r1 = buildRonda(1, profesor.account.address);
    const r2 = buildRonda(2, profesor.account.address);
    await factory.write.createGame([1n, 2n, diplomaURI, [r1, r2], entryFee], { account: profesor.account, value: creationFee });
    const gameAddr = await factory.read.games([1n]);
    const game2 = await viem.getContractAt("KahootGame", gameAddr);

    await game2.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game2.write.startNextQuestion([enunciado, opciones, profeSalt], { account: profesor.account });
    await game2.write.commitAnswer([generateHash(1, "s1", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    
    await game2.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });

    await expectRevert(
      game2.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account }),
      "No esta en fase de commit"
    );
  });

  it("advanceToNextQuestion falla si la fase actual es commit (no reveal)", async function () {
    const r1 = buildRonda(1, profesor.account.address);
    const r2 = buildRonda(2, profesor.account.address);
    await factory.write.createGame([1n, 2n, diplomaURI, [r1, r2], entryFee], { account: profesor.account, value: creationFee });
    const gameAddr = await factory.read.games([1n]);
    const game2 = await viem.getContractAt("KahootGame", gameAddr);

    await game2.write.startNextQuestion([enunciado, opciones, profeSalt], { account: profesor.account });

    await expectRevert(
      game2.write.advanceToNextQuestion({ account: profesor.account }),
      "Primero hay que abrir los reveals"
    );
  });

  it("Seguridad del Profesor (start y close)", async function () {
    await expectRevert(
      game.write.startNextQuestion([enunciado, opciones, profeSalt], { account: alumnoTramposo.account }),
      "Solo el profe puede ejecutar esto"
    );
    await expectRevert(
      game.write.closeQuestionAndStartReveal([1, "fake"], { account: alumnoTramposo.account }),
      "Solo el profe puede ejecutar esto"
    );
  });

  it("Alumno no puede llamar startNextQuestion", async function () {
    await expectRevert(
      game.write.startNextQuestion([enunciado, opciones, profeSalt], { account: alumnoHonesto.account }),
      "Solo el profe puede ejecutar esto"
    );
  });

  it("Alumno no puede llamar closeQuestionAndStartReveal", async function () {
    await game.write.startNextQuestion([enunciado, opciones, profeSalt], { account: profesor.account });
    await expectRevert(
      game.write.closeQuestionAndStartReveal([1, profeSalt], { account: alumnoHonesto.account }),
      "Solo el profe puede ejecutar esto"
    );
  });

  it("Alumno no puede llamar advanceToNextQuestion", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.startNextQuestion([enunciado, opciones, profeSalt], { account: profesor.account });
    await game.write.commitAnswer([generateHash(1, "s1", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });

    await expectRevert(
      game.write.advanceToNextQuestion({ account: alumnoHonesto.account }),
      "Solo el profe puede ejecutar esto"
    );
  });

  it("Owner (no profesor) tampoco puede ejecutar funciones de profesor", async function () {
    await expectRevert(
      game.write.startNextQuestion([enunciado, opciones, profeSalt], { account: owner.account }),
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

  it("startNextQuestion falla cuando no hay más preguntas", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.startNextQuestion([enunciado, opciones, profeSalt], { account: profesor.account });
    await game.write.commitAnswer([generateHash(1, "s1", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });
    await game.write.revealAnswer([0n, 1, "s1"], { account: alumnoHonesto.account });
    await game.write.advanceToNextQuestion({ account: profesor.account });

    await expectRevert(
      game.write.startNextQuestion([enunciado, opciones, profeSalt], { account: profesor.account }),
      "El juego termino"
    );
  });

  it("closeQuestionAndStartReveal falla si no hay commit phase abierta", async function () {
    await expectRevert(
      game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account }),
      "No esta en fase de commit"
    );
  });

});

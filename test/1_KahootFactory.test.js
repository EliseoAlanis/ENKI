import { expect } from "chai";
import { network } from "hardhat";
import { describe, it, beforeEach } from "node:test";
import { keccak256, encodePacked, parseEther } from "viem";

describe("KahootFactory - Creación de Juegos y Validaciones", function () {
  let factory, game, diplomaNFT;
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
  });

  it("Factory revert si _totalQuestions == 0", async function () {
    await expectRevert(
      factory.write.createGame(
        [1n, 0n, diplomaURI, [], entryFee],
        { account: profesor.account, value: creationFee }
      ),
      "Debe tener preguntas"
    );
  });

  it("Factory revert si _passingScore == 0", async function () {
    const r1 = buildRonda(1, profesor.account.address);
    await expectRevert(
      factory.write.createGame(
        [0n, 1n, diplomaURI, [r1], entryFee],
        { account: profesor.account, value: creationFee }
      ),
      "Puntaje invalido"
    );
  });

  it("Factory revert si _passingScore > _totalQuestions", async function () {
    const r1 = buildRonda(1, profesor.account.address);
    const r2 = buildRonda(2, profesor.account.address);
    await expectRevert(
      factory.write.createGame(
        [5n, 2n, diplomaURI, [r1, r2], entryFee],
        { account: profesor.account, value: creationFee }
      ),
      "Puntaje mayor al total"
    );
  });

  it("Factory revert si rondas.length != _totalQuestions (menos rondas)", async function () {
    const r1 = buildRonda(1, profesor.account.address);
    const r2 = buildRonda(2, profesor.account.address);
    await expectRevert(
      factory.write.createGame(
        [2n, 3n, diplomaURI, [r1, r2], entryFee],
        { account: profesor.account, value: creationFee }
      ),
      "Rondas no coinciden"
    );
  });

  it("Factory revert si rondas tiene MÁS elementos que _totalQuestions", async function () {
    const r1 = buildRonda(1, profesor.account.address);
    await expectRevert(
      factory.write.createGame(
        [1n, 1n, diplomaURI, [r1, r1, r1], entryFee],
        { account: profesor.account, value: creationFee }
      ),
      "Rondas no coinciden"
    );
  });

  it("KahootFactory - getGamesCount funciona", async function () {
    const countAntes = await factory.read.getGamesCount();
    const r1 = buildRonda(1, profesor.account.address);

    await factory.write.createGame(
      [1n, 1n, diplomaURI, [r1], entryFee],
      { account: profesor.account, value: creationFee }
    );

    const countDespues = await factory.read.getGamesCount();
    expect(countDespues).to.equal(countAntes + 1n);
  });

  it("Factory revert si no se paga la tarifa de creacion", async function () {
    const r1 = buildRonda(1, profesor.account.address);
    await expectRevert(
      factory.write.createGame(
        [1n, 1n, diplomaURI, [r1], entryFee],
        { account: profesor.account }
      ),
      "Tarifa de creacion insuficiente"
    );
  });

  it("Factory: owner puede cambiar la tarifa de creacion", async function () {
    await factory.write.setCreationFee([parseEther("0.002")], { account: owner.account });
    const newFee = await factory.read.creationFee();
    expect(newFee).to.equal(parseEther("0.002"));
  });

  it("Factory: no-owner no puede cambiar la tarifa de creacion", async function () {
    await expectRevert(
      factory.write.setCreationFee([parseEther("0.002")], { account: profesor.account }),
      "Solo el owner"
    );
  });

  it("Factory: owner puede retirar las tarifas acumuladas", async function () {
    const r1 = buildRonda(1, profesor.account.address);
    await factory.write.createGame(
      [1n, 1n, diplomaURI, [r1], entryFee],
      { account: profesor.account, value: creationFee }
    );
    await factory.write.withdrawFees({ account: owner.account });
  });

});

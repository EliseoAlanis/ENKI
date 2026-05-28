import { expect } from "chai";
import { network } from "hardhat";
import { describe, it, beforeEach } from "node:test";
import { keccak256, encodePacked, parseEther } from "viem";

describe("KahootGame - Commit & Reveal Seguros", function () {
  let factory, game;
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
  });

  it("Reveal sin haber hecho commit previo (revelación fantasma)", async function () {
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

  it("Commit de bytes32(0) debería fallar", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.startNextQuestion({ account: profesor.account });
    const nullHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

    await expectRevert(
      game.write.commitAnswer([nullHash], { account: alumnoHonesto.account }),
      "Hash nulo"
    );
  });

  it("No se puede hacer commit dos veces en la misma pregunta", async function () {
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

  it("No se puede hacer reveal dos veces", async function () {
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

  it("Reveal con hash incorrecto (salt equivocado)", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([generateHash(1, "mi_salt_real", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });

    await expectRevert(
      game.write.revealAnswer([0n, 1, "salt_falso"], { account: alumnoHonesto.account }),
      "El hash no coincide con tu commit"
    );
  });

  it("Reveal con opción distinta a la commiteada", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([generateHash(1, "salt", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });

    await expectRevert(
      game.write.revealAnswer([0n, 2, "salt"], { account: alumnoHonesto.account }),
      "El hash no coincide con tu commit"
    );
  });

  it("El Profesor no puede cambiar la respuesta correcta (Doble Commit-Reveal)", async function () {
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

});

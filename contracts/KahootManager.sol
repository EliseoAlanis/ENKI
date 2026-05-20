// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./DiplomaNFT.sol";

contract KahootManager {
    using ECDSA for bytes32;

    address public oracleSigner; // La wallet del servidor Next.js
    DiplomaNFT public diplomaContract;
    
    mapping(address => uint256) public userScores;
    mapping(address => bool) public hasClaimed;

    event PuntajeRegistrado(address indexed alumno, uint256 puntos);

    constructor(address _oracleSigner, address _diplomaAddress) {
        oracleSigner = _oracleSigner;
        diplomaContract = DiplomaNFT(_diplomaAddress);
    }

    // La función que llama el alumno al final del juego
    function registrarPuntajeYReclamar(uint256 puntos, bytes memory signature) external {
        require(!hasClaimed[msg.sender], "Ya reclamaste tu premio");

        // 1. Recreamos el mensaje exacto que firmó el servidor off-chain
        bytes32 messageHash = keccak256(abi.encodePacked(msg.sender, puntos));
        
        // 2. Le aplicamos el prefijo estándar de Ethereum (protección de seguridad)
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);

        // 3. Recuperamos quién fue el que firmó esto usando la firma del alumno
        address recoveredSigner = ECDSA.recover(ethSignedMessageHash, signature);

        // 4. Verificamos que el firmante sea nuestro servidor
        require(recoveredSigner == oracleSigner, "Firma invalida o no autorizada");

        // 5. Guardamos los puntos y bloqueamos futuros reclamos
        userScores[msg.sender] = puntos;
        hasClaimed[msg.sender] = true;

        // 6. Disparamos la creación del NFT hacia la wallet del alumno
        diplomaContract.mint(msg.sender);

        emit PuntajeRegistrado(msg.sender, puntos);
    }
}